// src/server.js - 개선된 버전
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// 라우트 및 서비스 임포트
import DatabaseManager from './database/DatabaseManager.js';
import AuthService from './services/AuthService.js';
import GameService from './services/GameService.js';
import createAuthRoutes from './routes/auth.js';
import createGameRoutes from './routes/game.js';
import { authenticateSocket } from './middleware/socketAuth.js';

dotenv.config();

class GameServer {
    constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.io = new SocketIOServer(this.server, {
            cors: {
                origin: process.env.CORS_ORIGIN || "*",
                methods: ["GET", "POST"],
                credentials: true
            }
        });
        
        this.port = process.env.PORT || 3000;
        
        // 서비스 초기화는 데이터베이스 연결 후에 수행
        this.db = null;
        this.authService = null;
        this.gameService = null;
        
        this.setupMiddleware();
    }
    
    async initializeDatabase() {
        try {
            console.log('🗄 데이터베이스 초기화 시작...');
            
            this.db = new DatabaseManager();
            await this.db.initialize();
            await this.db.createTables();
            await this.db.createInitialData();
            
            // 서비스 초기화 (데이터베이스 연결 후)
            this.authService = new AuthService(this.db);
            this.gameService = new GameService(this.db);
            
            console.log('✅ 데이터베이스 및 서비스 초기화 완료');
        } catch (error) {
            console.error('❌ 데이터베이스 초기화 실패:', error);
            throw error;
        }
    }
    
    setupMiddleware() {
        // 보안 미들웨어
        this.app.use(helmet({
            contentSecurityPolicy: false, // 개발 환경용
            crossOriginEmbedderPolicy: false
        }));
        
        this.app.use(cors({
            origin: process.env.CORS_ORIGIN || "*",
            credentials: true
        }));
        
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true }));
        
        // Rate limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15분
            max: 100, // 요청 제한
            message: {
                success: false,
                error: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.'
            }
        });
        this.app.use('/api/', limiter);
        
        // 로깅 미들웨어
        this.app.use((req, res, next) => {
            const timestamp = new Date().toISOString();
            console.log(`${timestamp} - ${req.method} ${req.url} - IP: ${req.ip}`);
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
                features: ['auth', 'trading', 'realtime', 'websocket'],
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });
        
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                database: this.db ? 'connected' : 'disconnected',
                services: {
                    auth: this.authService ? 'ready' : 'not ready',
                    game: this.gameService ? 'ready' : 'not ready'
                },
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
                        login: 'POST /api/auth/login',
                        refresh: 'POST /api/auth/refresh'
                    },
                    game: {
                        player: 'GET /api/game/player (인증 필요)',
                        updateLocation: 'PUT /api/game/player/location (인증 필요)',
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
        
        // API 라우트 등록 (서비스가 초기화된 후에 호출됨)
        if (this.authService && this.gameService) {
            this.app.use('/api/auth', createAuthRoutes(this.authService));
            this.app.use('/api/game', createGameRoutes(this.gameService, this.db));
        } else {
            console.warn('⚠️  서비스가 아직 초기화되지 않아 라우트를 등록할 수 없습니다.');
        }
        
        // 404 핸들러
        this.app.use('*', (req, res) => {
            res.status(404).json({
                success: false,
                error: 'Route not found',
                path: req.originalUrl,
                method: req.method
            });
        });
        
        // 에러 핸들러
        this.app.use((err, req, res, next) => {
            console.error('Server Error:', err);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? err.message : '서버 오류가 발생했습니다.'
            });
        });
    }
    
    setupSocket() {
        // Socket 인증 미들웨어
        this.io.use(authenticateSocket);
        
        this.io.on('connection', (socket) => {
            console.log(`👤 인증된 클라이언트 연결: ${socket.id} (사용자: ${socket.userId})`);
            
            // 환영 메시지
            socket.emit('welcome', {
                message: '서버에 연결되었습니다!',
                socketId: socket.id,
                userId: socket.userId,
                timestamp: new Date().toISOString()
            });
            
            // 사용자별 룸 참가
            socket.join(`user_${socket.userId}`);
            
            // 위치 업데이트
            socket.on('updateLocation', async (data) => {
                try {
                    const { latitude, longitude } = data;
                    
                    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                        socket.emit('error', { message: '잘못된 위치 데이터입니다.' });
                        return;
                    }
                    
                    // 데이터베이스에 위치 업데이트
                    await this.gameService.updatePlayerLocation(socket.userId, latitude, longitude);
                    
                    // 주변 상인 찾기
                    const nearbyMerchants = await this.gameService.findNearbyMerchants(latitude, longitude);
                    socket.emit('nearbyMerchants', nearbyMerchants);
                    
                    // 주변 플레이어에게 위치 브로드캐스트
                    socket.broadcast.emit('playerLocationUpdate', {
                        userId: socket.userId,
                        latitude,
                        longitude
                    });
                    
                } catch (error) {
                    console.error('위치 업데이트 오류:', error);
                    socket.emit('error', { message: '위치 업데이트 실패' });
                }
            });
            
            // 실시간 거래 알림
            socket.on('requestTradeUpdates', () => {
                socket.join('trade_updates');
            });
            
            // 시장 가격 업데이트 요청
            socket.on('requestMarketPrices', async () => {
                try {
                    const prices = await this.gameService.getCurrentMarketPrices();
                    socket.emit('marketPrices', prices);
                } catch (error) {
                    socket.emit('error', { message: '시장 가격 조회 실패' });
                }
            });
            
            // 연결 해제
            socket.on('disconnect', (reason) => {
                console.log(`👋 클라이언트 연결 해제: ${socket.id} (사용자: ${socket.userId}, 이유: ${reason})`);
            });
        });
        
        // 주기적 가격 업데이트 (3시간마다)
        setInterval(async () => {
            try {
                const priceUpdates = await this.gameService.updateMarketPrices();
                this.io.emit('priceUpdate', priceUpdates);
                console.log('📊 시장 가격 업데이트 브로드캐스트 완료');
            } catch (error) {
                console.error('시장 가격 업데이트 오류:', error);
            }
        }, 3 * 60 * 60 * 1000);
    }
    
    async start() {
        try {
            // 1. 데이터베이스 및 서비스 초기화
            await this.initializeDatabase();
            
            // 2. 라우트 설정 (서비스 초기화 후)
            this.setupRoutes();
            
            // 3. Socket 설정
            this.setupSocket();
            
            // 4. 서버 시작
            this.server.listen(this.port, () => {
                console.log('🎉 서버 시작 완료!');
                console.log(`📍 주소: http://localhost:${this.port}`);
                console.log(`💊 헬스체크: http://localhost:${this.port}/health`);
                console.log(`🔌 Socket.IO: ws://localhost:${this.port}`);
                console.log(`📊 API 문서: http://localhost:${this.port}/api`);
                console.log(`🔐 회원가입: POST http://localhost:${this.port}/api/auth/register`);
                console.log(`🔑 로그인: POST http://localhost:${this.port}/api/auth/login`);
                console.log(`🎮 게임 데이터: GET http://localhost:${this.port}/api/game/player`);
            });
        } catch (error) {
            console.error('❌ 서버 시작 실패:', error);
            process.exit(1);
        }
    }
    
    async stop() {
        console.log('🛑 서버 종료 중...');
        
        try {
            // Socket 연결 정리
            this.io.close();
            
            // 데이터베이스 연결 종료
            if (this.db) {
                await this.db.close();
            }
            
            this.server.close(() => {
                console.log('✅ 서버 종료 완료');
                process.exit(0);
            });
        } catch (error) {
            console.error('서버 종료 중 오류:', error);
            process.exit(1);
        }
    }
}

// 서버 실행
const server = new GameServer();

// 안전한 종료 처리
process.on('SIGTERM', () => server.stop());
process.on('SIGINT', () => server.stop());
process.on('uncaughtException', (error) => {
    console.error('치명적 오류:', error);
    server.stop();
});

server.start();