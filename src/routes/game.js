// src/routes/game.js - 수정된 버전
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

export default function createGameRoutes(gameService, db) {
    
    // 플레이어 데이터 조회 (iOS 클라이언트와 일치)
    router.get('/player', authenticateToken, async (req, res) => {
        try {
            const result = await gameService.getPlayerData(req.user.userId);
            
            if (result.success) {
                res.json({
                    success: true,
                    data: result.data
                });
            } else {
                res.status(404).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('플레이어 데이터 조회 오류:', error);
            res.status(500).json({
                success: false,
                error: '플레이어 데이터 조회 실패'
            });
        }
    });
    
    // 플레이어 위치 업데이트 (PUT 메서드로 수정)
    router.put('/player/location', authenticateToken, async (req, res) => {
        try {
            const { latitude, longitude } = req.body;
            
            // 입력 검증
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
                return res.status(400).json({
                    success: false,
                    error: '유효한 위도와 경도가 필요합니다.'
                });
            }
            
            // 서울 지역 범위 검증 (대략적)
            if (latitude < 37.4 || latitude > 37.7 || longitude < 126.8 || longitude > 127.2) {
                return res.status(400).json({
                    success: false,
                    error: '서울 지역 내에서만 플레이 가능합니다.'
                });
            }
            
            const result = await gameService.updatePlayerLocation(req.user.userId, latitude, longitude);
            res.json(result);
            
        } catch (error) {
            console.error('위치 업데이트 오류:', error);
            res.status(500).json({
                success: false,
                error: '위치 업데이트 실패'
            });
        }
    });
    
    // 시장 가격 조회
    router.get('/market/prices', async (req, res) => {
        try {
            const prices = await gameService.getCurrentMarketPrices();
            res.json({
                success: true,
                data: prices
            });
        } catch (error) {
            console.error('시장 가격 조회 오류:', error);
            res.status(500).json({
                success: false,
                error: '시장 가격 조회 실패'
            });
        }
    });
    
    // 주변 상인 조회
    router.get('/merchants', async (req, res) => {
        try {
            const { latitude, longitude, radius = 1000 } = req.query;
            
            let merchants;
            if (latitude && longitude) {
                merchants = await gameService.findNearbyMerchants(
                    parseFloat(latitude), 
                    parseFloat(longitude), 
                    parseInt(radius)
                );
            } else {
                merchants = await gameService.getAllMerchants();
            }
            
            res.json({
                success: true,
                data: merchants
            });
        } catch (error) {
            console.error('상인 조회 오류:', error);
            res.status(500).json({
                success: false,
                error: '상인 조회 실패'
            });
        }
    });
    
    // 아이템 구매
    router.post('/trade/buy', authenticateToken, async (req, res) => {
        try {
            const { merchantId, itemName, quantity = 1 } = req.body;
            
            if (!merchantId || !itemName) {
                return res.status(400).json({
                    success: false,
                    error: '상인 ID와 아이템 이름이 필요합니다.'
                });
            }
            
            if (quantity < 1 || quantity > 10) {
                return res.status(400).json({
                    success: false,
                    error: '구매 수량은 1-10개 사이여야 합니다.'
                });
            }
            
            const result = await gameService.buyItem(req.user.userId, merchantId, itemName, quantity);
            
            if (result.success) {
                res.json({
                    success: true,
                    data: result.data,
                    message: '구매가 완료되었습니다.'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('아이템 구매 오류:', error);
            res.status(500).json({
                success: false,
                error: '아이템 구매 실패'
            });
        }
    });
    
    // 아이템 판매
    router.post('/trade/sell', authenticateToken, async (req, res) => {
        try {
            const { itemId, merchantId, quantity = 1 } = req.body;
            
            if (!itemId || !merchantId) {
                return res.status(400).json({
                    success: false,
                    error: '아이템 ID와 상인 ID가 필요합니다.'
                });
            }
            
            const result = await gameService.sellItem(req.user.userId, itemId, merchantId, quantity);
            
            if (result.success) {
                res.json({
                    success: true,
                    data: result.data,
                    message: '판매가 완료되었습니다.'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('아이템 판매 오류:', error);
            res.status(500).json({
                success: false,
                error: '아이템 판매 실패'
            });
        }
    });
    
    // 거래 기록 조회
    router.get('/trade/history', authenticateToken, async (req, res) => {
        try {
            const { page = 1, limit = 20 } = req.query;
            
            const result = await gameService.getTradeHistory(
                req.user.userId, 
                parseInt(page), 
                parseInt(limit)
            );
            
            res.json({
                success: true,
                data: result.trades,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: result.total
                }
            });
        } catch (error) {
            console.error('거래 기록 조회 오류:', error);
            res.status(500).json({
                success: false,
                error: '거래 기록 조회 실패'
            });
        }
    });
    
    // 라이센스 업그레이드
    router.post('/license/upgrade', authenticateToken, async (req, res) => {
        try {
            const result = await gameService.upgradeLicense(req.user.userId);
            
            if (result.success) {
                res.json({
                    success: true,
                    data: result.data,
                    message: '라이센스가 업그레이드되었습니다.'
                });
            } else {
                res.status(400).json({
                    success: false,
                    error: result.error
                });
            }
        } catch (error) {
            console.error('라이센스 업그레이드 오류:', error);
            res.status(500).json({
                success: false,
                error: '라이센스 업그레이드 실패'
            });
        }
    });
    
    return router;
}