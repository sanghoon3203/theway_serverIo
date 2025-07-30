// src/database/DatabaseManager.js - 완전한 버전
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseManager {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '../../data/game.db');
        
        // data 디렉토리가 없으면 생성
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
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
                
                // 메서드를 Promise로 변환
                this.db.run = promisify(this.db.run.bind(this.db));
                this.db.get = promisify(this.db.get.bind(this.db));
                this.db.all = promisify(this.db.all.bind(this.db));
                
                // 외래 키 제약 조건 활성화
                this.db.run('PRAGMA foreign_keys = ON');
                
                resolve();
            });
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
                quantity INTEGER DEFAULT 1,
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
                quantity INTEGER DEFAULT 1,
                trade_type TEXT NOT NULL,
                location_lat REAL,
                location_lng REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (seller_id) REFERENCES players (id),
                FOREIGN KEY (buyer_id) REFERENCES players (id)
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
                id: 'merchant_gangnam_it',
                name: '강남 IT상인',
                type: 'electronics',
                district: '강남구',
                lat: 37.5173,
                lng: 127.0473,
                license: 1,
                inventory: JSON.stringify(['IT부품 (커먼)', 'IT부품 (중급)'])
            },
            {
                id: 'merchant_hongdae_art',
                name: '홍대 예술품상인',
                type: 'art',
                district: '홍대',
                lat: 37.5563,
                lng: 126.9238,
                license: 1,
                inventory: JSON.stringify(['예술품 (커먼)', '예술품 (중급)'])
            },
            {
                id: 'merchant_myeongdong_beauty',
                name: '명동 화장품상인',
                type: 'beauty',
                district: '명동',
                lat: 37.5636,
                lng: 126.9827,
                license: 1,
                inventory: JSON.stringify(['화장품 (커먼)', '화장품 (중급)'])
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
    
    // === 사용자 관련 메서드 ===
    async createUser(userData) {
        const sql = `
            INSERT INTO users (id, email, password_hash)
            VALUES (?, ?, ?)
        `;
        return await this.db.run(sql, [userData.id, userData.email, userData.passwordHash]);
    }
    
    async getUserByEmail(email) {
        const sql = `SELECT * FROM users WHERE email = ?`;
        return await this.db.get(sql, [email]);
    }
    
    async getUserById(id) {
        const sql = `SELECT * FROM users WHERE id = ?`;
        return await this.db.get(sql, [id]);
    }
    
    // === 플레이어 관련 메서드 ===
    async createPlayer(playerData) {
        const sql = `
            INSERT INTO players (id, user_id, name, money, trust_points, current_license, max_inventory_size)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        return await this.db.run(sql, [
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
        return await this.db.run(sql, values);
    }
    
    async updatePlayerLocation(playerId, latitude, longitude) {
        const sql = `
            UPDATE players 
            SET location_lat = ?, location_lng = ?, last_active = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;
        return await this.db.run(sql, [latitude, longitude, playerId]);
    }
    
    // === 인벤토리 관련 메서드 ===
    async getPlayerInventory(playerId) {
        const sql = `SELECT * FROM inventory WHERE player_id = ? ORDER BY acquired_at DESC`;
        return await this.db.all(sql, [playerId]);
    }
    
    async addItemToInventory(inventoryData) {
        const sql = `
            INSERT INTO inventory (id, player_id, item_name, item_category, base_price, current_price, item_grade, required_license, quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        return await this.db.run(sql, [
            inventoryData.id,
            inventoryData.playerId,
            inventoryData.itemName,
            inventoryData.itemCategory,
            inventoryData.basePrice,
            inventoryData.currentPrice,
            inventoryData.itemGrade,
            inventoryData.requiredLicense,
            inventoryData.quantity || 1
        ]);
    }
    
    async removeItemFromInventory(itemId, quantity = 1) {
        // 현재 수량 확인
        const item = await this.db.get('SELECT * FROM inventory WHERE id = ?', [itemId]);
        if (!item) {
            throw new Error('아이템을 찾을 수 없습니다.');
        }
        
        if (item.quantity <= quantity) {
            // 수량이 부족하거나 같으면 완전 삭제
            const sql = `DELETE FROM inventory WHERE id = ?`;
            return await this.db.run(sql, [itemId]);
        } else {
            // 수량만 감소
            const sql = `UPDATE inventory SET quantity = quantity - ? WHERE id = ?`;
            return await this.db.run(sql, [quantity, itemId]);
        }
    }
    
    // === 시장 가격 관련 메서드 ===
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
        return await this.db.run(sql, [newPrice, itemName]);
    }
    
    async getMarketPrice(itemName) {
        const sql = `SELECT * FROM market_prices WHERE item_name = ?`;
        return await this.db.get(sql, [itemName]);
    }
    
    // === 상인 관련 메서드 ===
    async getAllMerchants() {
        const sql = `SELECT * FROM merchants ORDER BY district, name`;
        return await this.db.all(sql);
    }
    
    async getMerchantById(merchantId) {
        const sql = `SELECT * FROM merchants WHERE id = ?`;
        return await this.db.get(sql, [merchantId]);
    }
    
    async findNearbyMerchants(latitude, longitude, radiusKm = 1) {
        // Haversine 공식을 사용한 거리 계산
        const sql = `
            SELECT *, 
                   (6371 * acos(cos(radians(?)) * cos(radians(location_lat)) * 
                   cos(radians(location_lng) - radians(?)) + 
                   sin(radians(?)) * sin(radians(location_lat)))) AS distance 
            FROM merchants 
            HAVING distance < ? 
            ORDER BY distance
        `;
        return await this.db.all(sql, [latitude, longitude, latitude, radiusKm]);
    }
    
    // === 거래 기록 관련 메서드 ===
    async createTradeRecord(tradeData) {
        const sql = `
            INSERT INTO trades (id, seller_id, buyer_id, merchant_id, item_name, item_category, price, quantity, trade_type, location_lat, location_lng)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        return await this.db.run(sql, [
            tradeData.id,
            tradeData.sellerId,
            tradeData.buyerId,
            tradeData.merchantId,
            tradeData.itemName,
            tradeData.itemCategory,
            tradeData.price,
            tradeData.quantity || 1,
            tradeData.tradeType,
            tradeData.locationLat,
            tradeData.locationLng
        ]);
    }
    
    async getTradeHistory(playerId, page = 1, limit = 20) {
        const offset = (page - 1) * limit;
        
        const sql = `
            SELECT * FROM trades 
            WHERE seller_id = ? OR buyer_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ? OFFSET ?
        `;
        
        const countSql = `
            SELECT COUNT(*) as total FROM trades 
            WHERE seller_id = ? OR buyer_id = ?
        `;
        
        const [trades, countResult] = await Promise.all([
            this.db.all(sql, [playerId, playerId, limit, offset]),
            this.db.get(countSql, [playerId, playerId])
        ]);
        
        return {
            trades,
            total: countResult.total
        };
    }
    
    // === 유틸리티 메서드 ===
    async close() {
        if (this.db) {
            return new Promise((resolve) => {
                this.db.close((err) => {
                    if (err) {
                        console.error('데이터베이스 종료 오류:', err);
                    } else {
                        console.log('✅ 데이터베이스 연결 종료');
                    }
                    resolve();
                });
            });
        }
    }
    
    // 데이터베이스 통계 조회
    async getStats() {
        const stats = {};
        
        try {
            const userCount = await this.db.get('SELECT COUNT(*) as count FROM users');
            const playerCount = await this.db.get('SELECT COUNT(*) as count FROM players');
            const tradeCount = await this.db.get('SELECT COUNT(*) as count FROM trades');
            
            stats.users = userCount.count;
            stats.players = playerCount.count;
            stats.trades = tradeCount.count;
            
        } catch (error) {
            console.error('통계 조회 오류:', error);
        }
        
        return stats;
    }
}

export default DatabaseManager;
