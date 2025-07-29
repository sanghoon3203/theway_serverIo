import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// GameService는 server.js에서 주입받을 예정
export default function createGameRoutes(gameService, db) {
    
    // 플레이어 데이터 조회
    router.get('/player/data', authenticateToken, async (req, res) => {
        const result = await gameService.getPlayerData(req.user.userId);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    });
    
    // 플레이어 위치 업데이트
    router.post('/player/location', authenticateToken, async (req, res) => {
        const { latitude, longitude } = req.body;
        
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
            return res.status(400).json({
                success: false,
                error: '유효한 위도와 경도가 필요합니다.'
            });
        }
        
        const result = await gameService.updatePlayerLocation(req.user.userId, latitude, longitude);
        res.json(result);
    });
    
    // 아이템 구매
    router.post('/trade/buy', authenticateToken, async (req, res) => {
        const { merchantId, itemName } = req.body;
        
        if (!merchantId || !itemName) {
            return res.status(400).json({
                success: false,
                error: '상인 ID와 아이템 이름이 필요합니다.'
            });
        }
        
        const result = await gameService.buyItem(req.user.userId, merchantId, itemName);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    });
    
    // 아이템 판매
    router.post('/trade/sell', authenticateToken, async (req, res) => {
        const { itemId, merchantId } = req.body;
        
        if (!itemId || !merchantId) {
            return res.status(400).json({
                success: false,
                error: '아이템 ID와 상인 ID가 필요합니다.'
            });
        }
        
        const result = await gameService.sellItem(req.user.userId, itemId, merchantId);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    });
    
    // 거래 기록 조회
    router.get('/trade/history', authenticateToken, async (req, res) => {
        const limit = parseInt(req.query.limit) || 20;
        const result = await gameService.getTradeHistory(req.user.userId, limit);
        res.json(result);
    });
    
    // 시장 가격 조회 (로그인 불필요)
    router.get('/market/prices', async (req, res) => {
        try {
            const prices = await db.getAllMarketPrices();
            res.json({
                success: true,
                data: prices
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: '시장 가격 조회 실패'
            });
        }
    });
    
    // 상인 목록 조회 (로그인 불필요)
    router.get('/merchants', async (req, res) => {
        try {
            const merchants = await db.getAllMerchants();
            res.json({
                success: true,
                data: merchants.map(merchant => ({
                    id: merchant.id,
                    name: merchant.name,
                    type: merchant.type,
                    district: merchant.district,
                    location: {
                        lat: merchant.location_lat,
                        lng: merchant.location_lng
                    },
                    requiredLicense: merchant.required_license,
                    inventory: JSON.parse(merchant.inventory || '[]')
                }))
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: '상인 목록 조회 실패'
            });
        }
    });
    
    return router;
}