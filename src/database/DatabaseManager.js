import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseManager {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '../../data/game.db');
    }
    
    async initialize() {
        console.log('🗄 데이터베이스 초기화 중...');
        
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('❌ 데이터베이스 연결 실패:', err);
                    reject(err);
                    return;
                }
                console.log(`✅ SQLite 연결: ${this.dbPath}`);
                resolve();
            });
            
            // 메서드를 Promise로 변환
            this.db.run = promisify(this.db.run.bind(this.db));
            this.db.get = promisify(this.db.get.bind(this.db));
            this.db.all = promisify(this.db.all.bind(this.db));
        });
    }
    
    async createTables() {
        console.log('📋 데이터베이스 테이블 생성 중...');
        
        const tables = [
            // 사용자 계정 테이블
            `CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // 플레이어 게임 데이터 테이블
            `CREATE TABLE IF NOT EXISTS players (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                money INTEGER DEFAULT 50000,
                trust_points INTEGER DEFAULT 0,
                current_license INTEGER DEFAULT 1,
                max_inventory_size INTEGER DEFAULT 5,
                location_lat REAL,
                location_lng REAL,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )`,
            
            // 인벤토리 테이블
            `CREATE TABLE IF NOT EXISTS inventory (
                id TEXT PRIMARY KEY,
                player_id TEXT NOT NULL,
                item_name TEXT NOT NULL,
                item_category TEXT NOT NULL,
                base_price INTEGER NOT NULL,
                current_price INTEGER NOT NULL,
                item_grade TEXT NOT NULL,
                required_license INTEGER NOT NULL,
                acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
            )`,
            
            // 거래 기록 테이블
            `CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                seller_id TEXT,
                buyer_id TEXT,
                merchant_id TEXT,
                item_name TEXT NOT NULL,
                item_category TEXT NOT NULL,
                price INTEGER NOT NULL,
                trade_type TEXT NOT NULL,
                location_lat REAL,
                location_lng REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // 시장 가격 테이블
            `CREATE TABLE IF NOT EXISTS market_prices (
                item_name TEXT PRIMARY KEY,
                district TEXT NOT NULL,
                base_price INTEGER NOT NULL,
                current_price INTEGER NOT NULL,
                demand_multiplier REAL DEFAULT 1.0,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // 상인 테이블
            `CREATE TABLE IF NOT EXISTS merchants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                district TEXT NOT NULL,
                location_lat REAL NOT NULL,
                location_lng REAL NOT NULL,
                required_license INTEGER NOT NULL,
                inventory TEXT, -- JSON 문자열
                trust_level INTEGER DEFAULT 0,
                last_restocked DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];
        
        for (const sql of tables) {
            await this.db.run(sql);
        }
        
        console.log('✅ 데이터베이스 테이블 생성 완료');
    }
    
    async createInitialData() {
        console.log('📦 초기 데이터 생성 중...');
        
        // 시장 가격 초기 데이터
        const items = [
            { name: 'IT부품 (커먼)', category: 'IT부품', basePrice: 5000, district: '강남구' },
            { name: 'IT부품 (중급)', category: 'IT부품', basePrice: 15000, district: '강남구' },
            { name: 'IT부품 (고급)', category: 'IT부품', basePrice: 35000, district: '강남구' },
            { name: '명품 (커먼)', category: '명품', basePrice: 10000, district: '강남구' },
            { name: '명품 (중급)', category: '명품', basePrice: 25000, district: '강남구' },
            { name: '예술품 (커먼)', category: '예술품', basePrice: 8000, district: '홍대' },
            { name: '예술품 (중급)', category: '예술품', basePrice: 20000, district: '홍대' },
            { name: '화장품 (커먼)', category: '화장품', basePrice: 3000, district: '명동' },
            { name: '화장품 (중급)', category: '화장품', basePrice: 8000, district: '명동' },
            { name: '서적 (커먼)', category: '서적', basePrice: 2000, district: '신촌' },
            { name: '생활용품 (커먼)', category: '생활용품', basePrice: 1500, district: '강북구' }
        ];
        
        for (const item of items) {
            const existing = await this.db.get(
                'SELECT * FROM market_prices WHERE item_name = ?', 
                [item.name]
            );
            
            if (!existing) {
                await this.db.run(`
                    INSERT INTO market_prices (item_name, district, base_price, current_price, demand_multiplier)
                    VALUES (?, ?, ?, ?, ?)
                `, [item.name, item.district, item.basePrice, item.basePrice, 1.0]);
            }
        }
        
        // 상인 초기 데이터
        const merchants = [
            { 
                id: 'merchant_gangnam_1', 
                name: '강남 IT상인', 
                type: 'retail', 
                district: '강남구', 
                lat: 37.5173, 
                lng: 126.9735, 
                license: 1,
                inventory: JSON.stringify([
                    { name: 'IT부품 (커먼)', category: 'IT부품', price: 5000, grade: '커먼' },
                    { name: 'IT부품 (중급)', category: 'IT부품', price: 15000, grade: '중급' }
                ])
            },
            { 
                id: 'merchant_hongdae_1', 
                name: '홍대 예술상인', 
                type: 'retail', 
                district: '홍대', 
                lat: 37.5563, 
                lng: 126.9236, 
                license: 1,
                inventory: JSON.stringify([
                    { name: '예술품 (커먼)', category: '예술품', price: 8000, grade: '커먼' },
                    { name: '예술품 (중급)', category: '예술품', price: 20000, grade: '중급' }
                ])
            },
            { 
                id: 'merchant_myeongdong_1', 
                name: '명동 화장품상인', 
                type: 'retail', 
                district: '명동', 
                lat: 37.5636, 
                lng: 126.9834, 
                license: 1,
                inventory: JSON.stringify([
                    { name: '화장품 (커먼)', category: '화장품', price: 3000, grade: '커먼' },
                    { name: '화장품 (중급)', category: '화장품', price: 8000, grade: '중급' }
                ])
            }
        ];
        
        for (const merchant of merchants) {
            const existing = await this.db.get(
                'SELECT * FROM merchants WHERE id = ?',
                [merchant.id]
            );
            
            if (!existing) {
                await this.db.run(`
                    INSERT INTO merchants (id, name, type, district, location_lat, location_lng, required_license, inventory)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [merchant.id, merchant.name, merchant.type, merchant.district, 
                    merchant.lat, merchant.lng, merchant.license, merchant.inventory]);
            }
        }
        
        console.log('✅ 초기 데이터 생성 완료');
    }
    
    // 사용자 관련 메서드
    async createUser(userData) {
        const sql = `
            INSERT INTO users (id, email, password_hash)
            VALUES (?, ?, ?)
        `;
        await this.db.run(sql, [userData.id, userData.email, userData.passwordHash]);
    }
    
    async getUserByEmail(email) {
        const sql = `SELECT * FROM users WHERE email = ?`;
        return await this.db.get(sql, [email]);
    }
    
    async getUserById(id) {
        const sql = `SELECT * FROM users WHERE id = ?`;
        return await this.db.get(sql, [id]);
    }
    
    // 플레이어 관련 메서드
    async createPlayer(playerData) {
        const sql = `
            INSERT INTO players (id, user_id, name, money, trust_points, current_license, max_inventory_size)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await this.db.run(sql, [
            playerData.id,
            playerData.userId,
            playerData.name,
            playerData.money || 50000,
            playerData.trustPoints || 0,
            playerData.currentLicense || 1,
            playerData.maxInventorySize || 5
        ]);
    }
    
    async getPlayerByUserId(userId) {
        const sql = `
            SELECT p.*, u.email 
            FROM players p 
            JOIN users u ON p.user_id = u.id 
            WHERE p.user_id = ?
        `;
        return await this.db.get(sql, [userId]);
    }
    
    async updatePlayer(playerId, updates) {
        const fields = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);
        values.push(playerId);
        
        const sql = `UPDATE players SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        await this.db.run(sql, values);
    }
    
    // 시장 가격 관련 메서드
    async getAllMarketPrices() {
        const sql = `SELECT * FROM market_prices ORDER BY item_name`;
        return await this.db.all(sql);
    }
    
    async updateMarketPrice(itemName, newPrice) {
        const sql = `
            UPDATE market_prices 
            SET current_price = ?, last_updated = CURRENT_TIMESTAMP 
            WHERE item_name = ?
        `;
        await this.db.run(sql, [newPrice, itemName]);
    }
    
    // 상인 관련 메서드
    async getAllMerchants() {
        const sql = `SELECT * FROM merchants ORDER BY district, name`;
        return await this.db.all(sql);
    }
    
    async getMerchantById(merchantId) {
        const sql = `SELECT * FROM merchants WHERE id = ?`;
        return await this.db.get(sql, [merchantId]);
    }
    
    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((err) => {
                    if (err) {
                        console.error('❌ 데이터베이스 종료 오류:', err);
                    } else {
                        console.log('✅ 데이터베이스 연결 종료');
                    }
                    resolve();
                });
            });
        }
    }
}

export default DatabaseManager;