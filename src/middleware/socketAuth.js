// src/middleware/socketAuth.js
import jwt from 'jsonwebtoken';

export const authenticateSocket = (socket, next) => {
    try {
        // Authorization 헤더에서 토큰 추출
        const token = socket.handshake.headers.authorization?.split(' ')[1] || 
                     socket.handshake.auth?.token ||
                     socket.handshake.query?.token;
        
        if (!token) {
            console.log(`❌ Socket 인증 실패: 토큰 없음 (${socket.id})`);
            return next(new Error('Authentication token required'));
        }
        
        // JWT 토큰 검증
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        // Socket 객체에 사용자 정보 저장
        socket.userId = decoded.userId; 
        socket.user = decoded;
        
        console.log(`✅ Socket 인증 성공: ${socket.id} (사용자: ${decoded.userId})`);
        next();
        
    } catch (error) {
        console.log(`❌ Socket 인증 실패: ${error.message} (${socket.id})`);
        
        if (error.name === 'TokenExpiredError') {
            next(new Error('Token expired'));
        } else if (error.name === 'JsonWebTokenError') {
            next(new Error('Invalid token'));
        } else {
            next(new Error('Authentication failed'));
        }
    }
};