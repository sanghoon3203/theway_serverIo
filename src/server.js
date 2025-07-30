import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// 새로운 임포트 추가
import DatabaseManager from './database/DatabaseManager.js';
import AuthService from './services/AuthService.js';
import GameService from './services/GameService.js';

// 환경 변수 로드
dotenv.config();

class GameServer {
    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.gameService = null;
        this.io = new SocketIOServer(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        this.port = process.env.PORT || 3000;
        
        // 데이터베이스 및 서비스 초기화
        this.db = new DatabaseManager();
        this.authService = new AuthService(this.db);
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocket();
    }
    
    // 데이터베이스 초기화 메서드 추가
    async initializeDatabase() {
        try {
            await this.db.initialize();
            await this.db.createTables();
            await this.db.createInitialData();
            this.gameService = new GameService(this.db);    
            console.log('✅ 데이터베이스 초기화 완료');
        } catch (error) {
            console.error('❌ 데이터베이스 초기화 실패:', error);
            throw error;
        }
    }
    
    setupMiddleware() {
        this.app.use(helmet());
        this.app.use(cors());
        this.app.use(express.json());
        
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 100
        });
        this.app.use('/api/', limiter);
        
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
            next();
        });
    }
    
    setupRoutes() {
        // 기본 라우트
        this.app.get('/', (req, res) => {
            res.json({
                message: '🎮 서울 대무역상 게임 서버',
                version: '1.0.0',
                status: 'running',
                database: 'connected',
                features: ['auth', 'trading', 'realtime'],
                timestamp: new Date().toISOString()
            });
        });
        
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                database: 'connected',
                timestamp: new Date().toISOString()
            });
        });
        
        this.app.get('/api', (req, res) => {
            res.json({
                message: 'Seoul Trader Game API',
                version: '1.0.0',
                endpoints: {
                    auth: {
                        register: 'POST /api/auth/register',
                        login: 'POST /api/auth/login'
                    },
                    game: {
                        playerData: 'GET /api/game/player/data (인증 필요)',
                        updateLocation: 'POST /api/game/player/location (인증 필요)',
                        buyItem: 'POST /api/game/trade/buy (인증 필요)',
                        sellItem: 'POST /api/game/trade/sell (인증 필요)',
                        tradeHistory: 'GET /api/game/trade/history (인증 필요)',
                        marketPrices: 'GET /api/game/market/prices',
                        merchants: 'GET /api/game/merchants'
                    },
                    websocket: '/socket.io'
                }
            });
        });
        
        // 라우트 등록 (constructor에서 서비스들을 초기화한 후)
        // 이 부분은 서버 시작 후에 추가할 예정
        this.app.use('/api/auth', createAuthRoutes(this.authService));
        this.app.use('/api/game', createGameRoutes(this.gameService, this.db));

        this.app.use('*', (req, res) => {
            res.status(404).json({
                error: 'Route not found',
                path: req.originalUrl
            });
        });
        
        this.app.use((err, req, res, next) => {
            console.error('Server Error:', err);
            res.status(500).json({
                error: 'Internal server error',
                message: err.message
            });
        });
    }
    
    // src/server.js - setupSocket 메서드 수정
setupSocket() {
    this.io.on('connection', (socket) => {
        console.log(`👤 클라이언트 연결: ${socket.id}`);
        
        // 환영 메시지
        socket.emit('welcome', {
            message: '서버에 연결되었습니다!',
            socketId: socket.id,
            timestamp: new Date().toISOString()
        });
        
        // 위치 업데이트
        socket.on('updateLocation', async (data) => {
            const { lat, lng } = data;
            
            // 주변 상인 찾기
            const nearbyMerchants = await this.gameService.findNearbyMerchants(lat, lng);
            socket.emit('nearbyMerchants', nearbyMerchants);
        });
        
        // 룸 참가 (지역별 가격 업데이트)
        socket.on('joinRoom', (roomId) => {
            socket.join(roomId);
            console.log(`${socket.id} joined room: ${roomId}`);
        });
        
        // 가격 업데이트 브로드캐스트 (3시간마다)
        setInterval(() => {
            const priceUpdates = this.gameService.getCurrentPrices();
            this.io.emit('priceUpdate', priceUpdates);
        }, 3 * 60 * 60 * 1000);
        
        socket.on('disconnect', (reason) => {
            console.log(`👋 클라이언트 연결 해제: ${socket.id} (이유: ${reason})`);
        });
    });
}
    
    async start() {
        try {
            // 데이터베이스 먼저 초기화
            await this.initializeDatabase();
            
            // 서버 시작
            this.server.listen(this.port, () => {
                console.log('🎉 서버 시작!');
                console.log(`📍 주소: http://localhost:${this.port}`);
                console.log(`💊 헬스체크: http://localhost:${this.port}/health`);
                console.log(`🔌 Socket.IO: ws://localhost:${this.port}`);
                console.log(`📊 API: http://localhost:${this.port}/api`);
                console.log(`🔐 회원가입: POST http://localhost:${this.port}/api/auth/register`);
                console.log(`🔑 로그인: POST http://localhost:${this.port}/api/auth/login`);
            });
        } catch (error) {
            console.error('❌ 서버 시작 실패:', error);
            process.exit(1);
        }
    }
    
    async stop() {
        console.log('🛑 서버 종료 중...');
        
        // 데이터베이스 연결 종료
        await this.db.close();
        
        this.server.close(() => {
            console.log('✅ 서버 종료 완료');
            process.exit(0);
        });
    }
}

// 서버 실행
const server = new GameServer();

process.on('SIGTERM', () => server.stop());
process.on('SIGINT', () => server.stop());

server.start();