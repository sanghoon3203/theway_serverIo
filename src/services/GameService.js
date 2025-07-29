import { v4 as uuidv4 } from 'uuid';

class GameService {
    constructor(database) {
        this.db = database;
    }
    
    // 플레이어 데이터 조회 (인벤토리 포함)
    async getPlayerData(userId) {
        try {
            // 플레이어 기본 정보
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            // 인벤토리 조회
            const inventory = await this.db.all(
                'SELECT * FROM inventory WHERE player_id = ? ORDER BY acquired_at DESC',
                [player.id]
            );
            
            return {
                success: true,
                data: {
                    id: player.id,
                    name: player.name,
                    money: player.money,
                    trustPoints: player.trust_points,
                    currentLicense: player.current_license,
                    maxInventorySize: player.max_inventory_size,
                    location: {
                        lat: player.location_lat,
                        lng: player.location_lng
                    },
                    inventory: inventory.map(item => ({
                        id: item.id,
                        name: item.item_name,
                        category: item.item_category,
                        basePrice: item.base_price,
                        currentPrice: item.current_price,
                        grade: item.item_grade,
                        requiredLicense: item.required_license,
                        acquiredAt: item.acquired_at
                    }))
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 플레이어 위치 업데이트
    async updatePlayerLocation(userId, latitude, longitude) {
        try {
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            await this.db.run(
                'UPDATE players SET location_lat = ?, location_lng = ?, last_active = CURRENT_TIMESTAMP WHERE id = ?',
                [latitude, longitude, player.id]
            );
            
            return {
                success: true,
                message: '위치가 업데이트되었습니다.'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 아이템 구매
    async buyItem(userId, merchantId, itemName) {
        try {
            // 플레이어 정보 조회
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            // 상인 정보 조회
            const merchant = await this.db.getMerchantById(merchantId);
            if (!merchant) {
                throw new Error('상인을 찾을 수 없습니다.');
            }
            
            // 상인 인벤토리에서 아이템 찾기
            const merchantInventory = JSON.parse(merchant.inventory || '[]');
            const item = merchantInventory.find(i => i.name === itemName);
            if (!item) {
                throw new Error('상인이 해당 아이템을 보유하고 있지 않습니다.');
            }
            
            // 현재 인벤토리 개수 확인
            const currentInventoryCount = await this.db.get(
                'SELECT COUNT(*) as count FROM inventory WHERE player_id = ?',
                [player.id]
            );
            
            if (currentInventoryCount.count >= player.max_inventory_size) {
                throw new Error('인벤토리가 가득 찼습니다.');
            }
            
            // 돈 확인
            if (player.money < item.price) {
                throw new Error('자금이 부족합니다.');
            }
            
            // 거래 실행 (트랜잭션)
            await this.db.run('BEGIN TRANSACTION');
            
            try {
                // 돈 차감
                await this.db.run(
                    'UPDATE players SET money = money - ?, trust_points = trust_points + 1 WHERE id = ?',
                    [item.price, player.id]
                );
                
                // 인벤토리에 아이템 추가
                const itemId = uuidv4();
                await this.db.run(`
                    INSERT INTO inventory (id, player_id, item_name, item_category, base_price, current_price, item_grade, required_license)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [itemId, player.id, item.name, item.category, item.price, item.price, item.grade, 1]);
                
                // 거래 기록
                const tradeId = uuidv4();
                await this.db.run(`
                    INSERT INTO trades (id, seller_id, buyer_id, merchant_id, item_name, item_category, price, trade_type, location_lat, location_lng)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [tradeId, merchantId, player.id, merchantId, item.name, item.category, item.price, 'buy', player.location_lat, player.location_lng]);
                
                await this.db.run('COMMIT');
                
                return {
                    success: true,
                    data: {
                        newMoney: player.money - item.price,
                        newTrustPoints: player.trust_points + 1,
                        acquiredItem: {
                            id: itemId,
                            name: item.name,
                            category: item.category,
                            price: item.price,
                            grade: item.grade
                        },
                        tradeId: tradeId
                    }
                };
                
            } catch (error) {
                await this.db.run('ROLLBACK');
                throw error;
            }
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 아이템 판매
    async sellItem(userId, itemId, merchantId) {
        try {
            // 플레이어 정보 조회
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            // 아이템 정보 조회
            const item = await this.db.get(
                'SELECT * FROM inventory WHERE id = ? AND player_id = ?',
                [itemId, player.id]
            );
            if (!item) {
                throw new Error('보유하지 않은 아이템입니다.');
            }
            
            // 상인 정보 조회
            const merchant = await this.db.getMerchantById(merchantId);
            if (!merchant) {
                throw new Error('상인을 찾을 수 없습니다.');
            }
            
            // 판매 가격 계산 (구매가의 80%)
            const sellPrice = Math.floor(item.current_price * 0.8);
            
            // 거래 실행 (트랜잭션)
            await this.db.run('BEGIN TRANSACTION');
            
            try {
                // 돈 증가
                await this.db.run(
                    'UPDATE players SET money = money + ?, trust_points = trust_points + 2 WHERE id = ?',
                    [sellPrice, player.id]
                );
                
                // 인벤토리에서 아이템 제거
                await this.db.run(
                    'DELETE FROM inventory WHERE id = ?',
                    [itemId]
                );
                
                // 거래 기록
                const tradeId = uuidv4();
                await this.db.run(`
                    INSERT INTO trades (id, seller_id, buyer_id, merchant_id, item_name, item_category, price, trade_type, location_lat, location_lng)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [tradeId, player.id, merchantId, merchantId, item.item_name, item.item_category, sellPrice, 'sell', player.location_lat, player.location_lng]);
                
                await this.db.run('COMMIT');
                
                return {
                    success: true,
                    data: {
                        newMoney: player.money + sellPrice,
                        newTrustPoints: player.trust_points + 2,
                        soldItem: {
                            name: item.item_name,
                            category: item.item_category,
                            sellPrice: sellPrice
                        },
                        tradeId: tradeId
                    }
                };
                
            } catch (error) {
                await this.db.run('ROLLBACK');
                throw error;
            }
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 거래 기록 조회
    async getTradeHistory(userId, limit = 20) {
        try {
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            const trades = await this.db.all(`
                SELECT * FROM trades 
                WHERE seller_id = ? OR buyer_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
            `, [player.id, player.id, limit]);
            
            return {
                success: true,
                data: trades.map(trade => ({
                    id: trade.id,
                    itemName: trade.item_name,
                    itemCategory: trade.item_category,
                    price: trade.price,
                    type: trade.trade_type,
                    timestamp: trade.timestamp,
                    location: {
                        lat: trade.location_lat,
                        lng: trade.location_lng
                    }
                }))
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

export default GameService;