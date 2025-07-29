import jwt from 'jsonwebtoken';

// JWT 토큰 검증 미들웨어
export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({
            success: false,
            error: '액세스 토큰이 필요합니다.'
        });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({
                success: false,
                error: '유효하지 않은 토큰입니다.'
            });
        }
        
        req.user = user; // { userId: "uuid" }
        next();
    });
};

// 옵셔널 인증 (토큰이 있으면 검증, 없어도 통과)
export const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
            if (!err) {
                req.user = user;
            }
        });
    }
    
    next();
};