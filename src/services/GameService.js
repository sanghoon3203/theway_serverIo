// src/services/GameService.js - 향상된 버전
import { v4 as uuidv4 } from 'uuid';

class GameService {
    constructor(database) {
        this.db = database;
    }
    
    // === 플레이어 데이터 관리 ===
    async getPlayerData(userId) {
        try {
            // 플레이어 기본 정보
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            // 인벤토리 조회
            const inventory = await this.db.getPlayerInventory(player.id);
            
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
                        quantity: item.quantity,
                        acquiredAt: item.acquired_at
                    })),
                    lastActive: player.last_active
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async updatePlayerLocation(userId, latitude, longitude) {
        try {
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            await this.db.updatePlayerLocation(player.id, latitude, longitude);
            
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
    
    // === 거래 시스템 ===
    async buyItem(userId, merchantId, itemName, quantity = 1) {
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
            
            // 라이센스 체크
            if (player.current_license < merchant.required_license) {
                throw new Error('라이센스가 부족합니다.');
            }
            
            // 상인 인벤토리 체크
            const merchantInventory = JSON.parse(merchant.inventory || '[]');
            if (!merchantInventory.includes(itemName)) {
                throw new Error('상인이 해당 아이템을 판매하지 않습니다.');
            }
            
            // 시장 가격 조회
            const marketPrice = await this.db.getMarketPrice(itemName);
            if (!marketPrice) {
                throw new Error('아이템 가격 정보를 찾을 수 없습니다.');
            }
            
            const totalPrice = marketPrice.current_price * quantity;
            
            // 돈 체크
            if (player.money < totalPrice) {
                throw new Error('돈이 부족합니다.');
            }
            
            // 인벤토리 공간 체크
            const currentInventory = await this.db.getPlayerInventory(player.id);
            const totalItems = currentInventory.reduce((sum, item) => sum + item.quantity, 0);
            
            if (totalItems + quantity > player.max_inventory_size) {
                throw new Error('인벤토리 공간이 부족합니다.');
            }
            
            // 트랜잭션 시작 (SQLite는 자동 커밋이므로 수동으로 관리)
            
            // 1. 돈 차감
            await this.db.updatePlayer(player.id, { 
                money: player.money - totalPrice 
            });
            
            // 2. 아이템을 인벤토리에 추가
            const itemGrade = this.determineItemGrade(itemName);
            const requiredLicense = this.getRequiredLicense(itemName);
            
            await this.db.addItemToInventory({
                id: uuidv4(),
                playerId: player.id,
                itemName: itemName,
                itemCategory: marketPrice.district, // 카테고리로 지역 사용
                basePrice: marketPrice.base_price,
                currentPrice: marketPrice.current_price,
                itemGrade: itemGrade,
                requiredLicense: requiredLicense,
                quantity: quantity
            });
            
            // 3. 거래 기록 생성
            await this.db.createTradeRecord({
                id: uuidv4(),
                sellerId: null, // 상인과의 거래
                buyerId: player.id,
                merchantId: merchantId,
                itemName: itemName,
                itemCategory: marketPrice.district,
                price: totalPrice,
                quantity: quantity,
                tradeType: 'buy',
                locationLat: player.location_lat,
                locationLng: player.location_lng
            });
            
            return {
                success: true,
                data: {
                    itemName,
                    quantity,
                    totalPrice,
                    remainingMoney: player.money - totalPrice
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async sellItem(userId, itemId, merchantId, quantity = 1) {
        try {
            // 플레이어 정보 조회
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            // 아이템 조회
            const item = await this.db.get('SELECT * FROM inventory WHERE id = ? AND player_id = ?', [itemId, player.id]);
            if (!item) {
                throw new Error('아이템을 찾을 수 없습니다.');
            }
            
            if (item.quantity < quantity) {
                throw new Error('판매하려는 수량이 보유 수량보다 많습니다.');
            }
            
            // 상인 정보 조회
            const merchant = await this.db.getMerchantById(merchantId);
            if (!merchant) {
                throw new Error('상인을 찾을 수 없습니다.');
            }
            
            // 판매 가격 계산 (현재 시장 가격의 90%)
            const sellPrice = Math.floor(item.current_price * 0.9);
            const totalPrice = sellPrice * quantity;
            
            // 1. 돈 추가
            await this.db.updatePlayer(player.id, { 
                money: player.money + totalPrice 
            });
            
            // 2. 아이템 제거/수량 감소
            await this.db.removeItemFromInventory(itemId, quantity);
            
            // 3. 거래 기록 생성
            await this.db.createTradeRecord({
                id: uuidv4(),
                sellerId: player.id,
                buyerId: null, // 상인과의 거래
                merchantId: merchantId,
                itemName: item.item_name,
                itemCategory: item.item_category,
                price: totalPrice,
                quantity: quantity,
                tradeType: 'sell',
                locationLat: player.location_lat,
                locationLng: player.location_lng
            });
            
            return {
                success: true,
                data: {
                    itemName: item.item_name,
                    quantity,
                    totalPrice,
                    newMoney: player.money + totalPrice
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // === 시장 가격 관리 ===
    async getCurrentMarketPrices() {
        try {
            const prices = await this.db.getAllMarketPrices();
            return prices.map(price => ({
                itemName: price.item_name,
                district: price.district,
                basePrice: price.base_price,
                currentPrice: price.current_price,
                demandMultiplier: price.demand_multiplier,
                lastUpdated: price.last_updated
            }));
        } catch (error) {
            console.error('시장 가격 조회 오류:', error);
            throw error;
        }
    }
    
    async updateMarketPrices() {
        try {
            const prices = await this.db.getAllMarketPrices();
            const updates = [];
            
            for (const price of prices) {
                // 가격 변동 로직 (±20% 범위)
                const variation = (Math.random() - 0.5) * 0.4; // -0.2 ~ 0.2
                const newPrice = Math.max(
                    Math.floor(price.base_price * 0.5), // 최소 기본가격의 50%
                    Math.min(
                        Math.floor(price.base_price * 1.5), // 최대 기본가격의 150%
                        Math.floor(price.current_price * (1 + variation))
                    )
                );
                
                await this.db.updateMarketPrice(price.item_name, newPrice);
                updates.push({
                    itemName: price.item_name,
                    oldPrice: price.current_price,
                    newPrice: newPrice,
                    change: newPrice - price.current_price
                });
            }
            
            console.log(`📊 ${updates.length}개 아이템 가격 업데이트 완료`);
            return updates;
            
        } catch (error) {
            console.error('시장 가격 업데이트 오류:', error);
            throw error;
        }
    }
    
    // === 상인 관리 ===
    async getAllMerchants() {
        try {
            const merchants = await this.db.getAllMerchants();
            return merchants.map(merchant => ({
                id: merchant.id,
                name: merchant.name,
                type: merchant.type,
                district: merchant.district,
                location: {
                    lat: merchant.location_lat,
                    lng: merchant.location_lng
                },
                requiredLicense: merchant.required_license,
                inventory: JSON.parse(merchant.inventory || '[]'),
                trustLevel: merchant.trust_level,
                lastRestocked: merchant.last_restocked
            }));
        } catch (error) {
            console.error('상인 조회 오류:', error);
            throw error;
        }
    }
    
    async findNearbyMerchants(latitude, longitude, radiusKm = 1) {
        try {
            const merchants = await this.db.findNearbyMerchants(latitude, longitude, radiusKm);
            return merchants.map(merchant => ({
                id: merchant.id,
                name: merchant.name,
                type: merchant.type,
                district: merchant.district,
                location: {
                    lat: merchant.location_lat,
                    lng: merchant.location_lng
                },
                requiredLicense: merchant.required_license,
                inventory: JSON.parse(merchant.inventory || '[]'),
                trustLevel: merchant.trust_level,
                distance: Math.round(merchant.distance * 1000) // 미터 단위로 변환
            }));
        } catch (error) {
            console.error('주변 상인 조회 오류:', error);
            throw error;
        }
    }
    
    // === 거래 기록 ===
    async getTradeHistory(userId, page = 1, limit = 20) {
        try {
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            return await this.db.getTradeHistory(player.id, page, limit);
        } catch (error) {
            console.error('거래 기록 조회 오류:', error);
            throw error;
        }
    }
    
    // === 라이센스 업그레이드 ===
    async upgradeLicense(userId) {
        try {
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            const currentLicense = player.current_license;
            const nextLicense = currentLicense + 1;
            
            // 최대 라이센스 체크
            if (nextLicense > 5) {
                throw new Error('이미 최고 등급 라이센스입니다.');
            }
            
            // 필요 조건 체크
            const requiredMoney = this.getLicenseUpgradeCost(nextLicense);
            const requiredTrust = this.getRequiredTrustPoints(nextLicense);
            
            if (player.money < requiredMoney) {
                throw new Error(`라이센스 업그레이드에 ${requiredMoney}원이 필요합니다.`);
            }
            
            if (player.trust_points < requiredTrust) {
                throw new Error(`신뢰도 ${requiredTrust}점이 필요합니다.`);
            }
            
            // 업그레이드 실행
            const newInventorySize = this.getInventorySize(nextLicense);
            
            await this.db.updatePlayer(player.id, {
                current_license: nextLicense,
                money: player.money - requiredMoney,
                max_inventory_size: newInventorySize
            });
            
            return {
                success: true,
                data: {
                    oldLicense: currentLicense,
                    newLicense: nextLicense,
                    cost: requiredMoney,
                    newInventorySize: newInventorySize,
                    remainingMoney: player.money - requiredMoney
                }
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // === 유틸리티 메서드 ===
    determineItemGrade(itemName) {
        if (itemName.includes('커먼')) return 'common';
        if (itemName.includes('중급')) return 'rare';
        if (itemName.includes('고급')) return 'epic';
        if (itemName.includes('전설')) return 'legendary';
        return 'common';
    }
    
    getRequiredLicense(itemName) {
        if (itemName.includes('커먼')) return 1;
        if (itemName.includes('중급')) return 2;
        if (itemName.includes('고급')) return 3;
        if (itemName.includes('전설')) return 4;
        return 1;
    }
    
    getLicenseUpgradeCost(license) {
        const costs = {
            2: 100000,   // 초급 → 중급
            3: 250000,   // 중급 → 고급
            4: 500000,   // 고급 → 전문
            5: 1000000   // 전문 → 마스터
        };
        return costs[license] || 0;
    }
    
    getRequiredTrustPoints(license) {
        const trust = {
            2: 50,    // 초급 → 중급
            3: 150,   // 중급 → 고급
            4: 300,   // 고급 → 전문
            5: 500    // 전문 → 마스터
        };
        return trust[license] || 0;
    }
    
    getInventorySize(license) {
        const sizes = {
            1: 5,   // 초급
            2: 8,   // 중급
            3: 12,  // 고급
            4: 16,  // 전문
            5: 20   // 마스터
        };
        return sizes[license] || 5;
    }
    
    // === 통계 및 리더보드 ===
    async getPlayerStats(userId) {
        try {
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            const tradeHistory = await this.db.getTradeHistory(player.id, 1, 1000);
            const totalTrades = tradeHistory.total;
            
            // 총 거래 금액 계산
            const totalTradeValue = tradeHistory.trades.reduce((sum, trade) => sum + trade.price, 0);
            
            // 가장 많이 거래한 아이템
            const itemCounts = {};
            tradeHistory.trades.forEach(trade => {
                itemCounts[trade.item_name] = (itemCounts[trade.item_name] || 0) + trade.quantity;
            });
            
            const favoriteItem = Object.keys(itemCounts).reduce((a, b) => 
                itemCounts[a] > itemCounts[b] ? a : b, null
            );
            
            return {
                success: true,
                data: {
                    playerId: player.id,
                    playerName: player.name,
                    currentMoney: player.money,
                    trustPoints: player.trust_points,
                    currentLicense: player.current_license,
                    totalTrades: totalTrades,
                    totalTradeValue: totalTradeValue,
                    favoriteItem: favoriteItem,
                    inventoryCount: await this.db.getPlayerInventory(player.id).then(inv => 
                        inv.reduce((sum, item) => sum + item.quantity, 0)
                    )
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async getLeaderboard(type = 'money', limit = 10) {
        try {
            let orderBy;
            switch (type) {
                case 'money':
                    orderBy = 'money DESC';
                    break;
                case 'trust':
                    orderBy = 'trust_points DESC';
                    break;
                case 'license':
                    orderBy = 'current_license DESC, money DESC';
                    break;
                default:
                    orderBy = 'money DESC';
            }
            
            const sql = `
                SELECT name, money, trust_points, current_license, 
                       ROW_NUMBER() OVER (ORDER BY ${orderBy}) as rank
                FROM players 
                ORDER BY ${orderBy}
                LIMIT ?
            `;
            
            const leaderboard = await this.db.all(sql, [limit]);
            
            return {
                success: true,
                data: leaderboard.map(player => ({
                    rank: player.rank,
                    name: player.name,
                    money: player.money,
                    trustPoints: player.trust_points,
                    license: player.current_license
                }))
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // === 게임 이벤트 ===
    async triggerRandomEvent() {
        try {
            const events = [
                {
                    type: 'price_surge',
                    description: '특정 아이템 가격 급등',
                    effect: async () => {
                        const prices = await this.db.getAllMarketPrices();
                        const randomItem = prices[Math.floor(Math.random() * prices.length)];
                        const newPrice = Math.floor(randomItem.current_price * 1.5);
                        await this.db.updateMarketPrice(randomItem.item_name, newPrice);
                        return `${randomItem.item_name} 가격이 급등했습니다! (${randomItem.current_price} → ${newPrice})`;
                    }
                },
                {
                    type: 'discount_event',
                    description: '전체 아이템 할인',
                    effect: async () => {
                        const prices = await this.db.getAllMarketPrices();
                        const updates = [];
                        for (const price of prices) {
                            const newPrice = Math.floor(price.current_price * 0.8);
                            await this.db.updateMarketPrice(price.item_name, newPrice);
                            updates.push(`${price.item_name}: ${price.current_price} → ${newPrice}`);
                        }
                        return `전체 아이템 20% 할인 이벤트! ${updates.length}개 아이템 가격 하락`;
                    }
                }
            ];
            
            const randomEvent = events[Math.floor(Math.random() * events.length)];
            const result = await randomEvent.effect();
            
            return {
                success: true,
                event: randomEvent.type,
                description: randomEvent.description,
                result: result
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // === 데일리 보너스 ===
    async claimDailyBonus(userId) {
        try {
            const player = await this.db.getPlayerByUserId(userId);
            if (!player) {
                throw new Error('플레이어를 찾을 수 없습니다.');
            }
            
            const lastActive = new Date(player.last_active);
            const now = new Date();
            const hoursSinceLastActive = (now - lastActive) / (1000 * 60 * 60);
            
            // 24시간 이후에만 보너스 지급
            if (hoursSinceLastActive < 24) {
                const remainingHours = Math.ceil(24 - hoursSinceLastActive);
                throw new Error(`${remainingHours}시간 후에 데일리 보너스를 받을 수 있습니다.`);
            }
            
            // 라이센스에 따른 보너스 계산
            const bonusAmount = 5000 * player.current_license;
            const bonusTrust = 5;
            
            await this.db.updatePlayer(player.id, {
                money: player.money + bonusAmount,
                trust_points: player.trust_points + bonusTrust
            });
            
            return {
                success: true,
                data: {
                    bonusMoney: bonusAmount,
                    bonusTrust: bonusTrust,
                    newMoney: player.money + bonusAmount,
                    newTrust: player.trust_points + bonusTrust
                }
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
