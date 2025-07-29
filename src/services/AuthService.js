import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

class AuthService {
    constructor(database) {
        this.db = database;
        this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
        this.saltRounds = 10;
    }
    
    async register(email, password, playerName) {
        try {
            // 이메일 중복 체크
            const existingUser = await this.db.getUserByEmail(email);
            if (existingUser) {
                throw new Error('이미 존재하는 이메일입니다.');
            }
            
            // 비밀번호 해시화
            const passwordHash = await bcrypt.hash(password, this.saltRounds);
            
            // 사용자 생성
            const userId = uuidv4();
            await this.db.createUser({
                id: userId,
                email: email,
                passwordHash: passwordHash
            });
            
            // 플레이어 데이터 생성
            const playerId = uuidv4();
            await this.db.createPlayer({
                id: playerId,
                userId: userId,
                name: playerName,
                money: 50000,
                trustPoints: 0,
                currentLicense: 1,
                maxInventorySize: 5
            });
            
            // JWT 토큰 생성
            const token = this.generateToken(userId);
            
            return {
                success: true,
                token: token,
                user: {
                    id: userId,
                    email: email
                },
                player: {
                    id: playerId,
                    name: playerName,
                    money: 50000,
                    trustPoints: 0,
                    currentLicense: 1
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async login(email, password) {
        try {
            // 사용자 조회
            const user = await this.db.getUserByEmail(email);
            if (!user) {
                throw new Error('이메일 또는 비밀번호가 잘못되었습니다.');
            }
            
            // 비밀번호 확인
            const isValidPassword = await bcrypt.compare(password, user.password_hash);
            if (!isValidPassword) {
                throw new Error('이메일 또는 비밀번호가 잘못되었습니다.');
            }
            
            // 플레이어 정보 조회
            const player = await this.db.getPlayerByUserId(user.id);
            if (!player) {
                throw new Error('플레이어 정보를 찾을 수 없습니다.');
            }
            
            // JWT 토큰 생성
            const token = this.generateToken(user.id);
            
            return {
                success: true,
                token: token,
                user: {
                    id: user.id,
                    email: user.email
                },
                player: {
                    id: player.id,
                    name: player.name,
                    money: player.money,
                    trustPoints: player.trust_points,
                    currentLicense: player.current_license,
                    maxInventorySize: player.max_inventory_size
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    generateToken(userId) {
        return jwt.sign(
            { userId: userId },
            this.jwtSecret,
            { expiresIn: '7d' }
        );
    }
    
    verifyToken(token) {
        try {
            return jwt.verify(token, this.jwtSecret);
        } catch (error) {
            return null;
        }
    }
}

export default AuthService;