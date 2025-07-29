import express from 'express';
const router = express.Router();

// AuthService는 server.js에서 주입받을 예정
export default function createAuthRoutes(authService) {
    // 회원가입
    router.post('/register', async (req, res) => {
        const { email, password, playerName } = req.body;
        
        if (!email || !password || !playerName) {
            return res.status(400).json({
                success: false,
                error: '이메일, 비밀번호, 플레이어 이름이 필요합니다.'
            });
        }
        
        // 간단한 유효성 검사
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: '비밀번호는 6자 이상이어야 합니다.'
            });
        }
        
        if (playerName.length < 2 || playerName.length > 20) {
            return res.status(400).json({
                success: false,
                error: '플레이어 이름은 2-20자 사이여야 합니다.'
            });
        }
        
        const result = await authService.register(email, password, playerName);
        
        if (result.success) {
            res.status(201).json(result);
        } else {
            res.status(400).json(result);
        }
    });
    
    // 로그인
    router.post('/login', async (req, res) => {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: '이메일과 비밀번호가 필요합니다.'
            });
        }
        
        const result = await authService.login(email, password);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(401).json(result);
        }
    });
    
    return router;
}