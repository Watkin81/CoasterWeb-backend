const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            'https://coasterweb-backend.onrender.com',
            'https://watkin81.github.io'
        ],
        methods: ['GET', 'POST'],
    },
});

const PORT = process.env.PORT || 7270;

app.use(cors({
    origin: [
        'https://coasterweb-backend.onrender.com',
        'https://watkin81.github.io'
    ],
}));

const loadCoastersData = () => {
    const filePath = './coasterData.json';
    const rawData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(rawData);
};

const data = loadCoastersData();
let gameCoasters = Array.isArray(data?.coasters) ? data.coasters : [];

function generateRoomCode(length = 6) {
    const characters = '0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

const DEFAULT_STARTING_HP = 2;
const DEFAULT_ROUND_TIME = 15000;

const roomConfigs = {};
const roomUsers = {};
const socketToUserId = {};
const userIdToSocket = {};
const roomHosts = {};
const usernames = {};
const roomGameStates = {};
const roomGameData = {};
let nextUserId = 1;

let publicRooms = [];

function createPublicRoom() {
    const roomCode = generateRoomCode();
    const config = {
        maxPlayers: 8,
        startingHealth: DEFAULT_STARTING_HP,
        roundTime: DEFAULT_ROUND_TIME,
        useImperial: true,
        isPublic: true
    };
    
    roomConfigs[roomCode] = config;
    roomUsers[roomCode] = [];
    roomGameStates[roomCode] = 'lobby';
    roomGameData[roomCode] = { playerHP: {} };
    
    publicRooms.push(roomCode);
    console.log(`Created public room: ${roomCode}`);
    return roomCode;
}

createPublicRoom();

function getAvailablePublicRoom() {
    for (const roomCode of publicRooms) {
        const userCount = roomUsers[roomCode]?.length || 0;
        const maxPlayers = roomConfigs[roomCode]?.maxPlayers || 8;
        const gameState = roomGameStates[roomCode];
        
        if (userCount < maxPlayers && gameState === 'lobby') {
            return roomCode;
        }
    }
    
    return createPublicRoom();
}

const criteriaTypes = [
    { name: "Height", key: "height", metricUnit: "meters", imperialUnit: "feet", metricFormat: (v) => `${v}m`, imperialFormat: (v) => `${(v * 3.28084).toFixed(0)}ft`, type: "range" },
    { name: "Speed", key: "speed", metricUnit: "km/h", imperialUnit: "mph", metricFormat: (v) => `${v} km/h`, imperialFormat: (v) => `${(v * 0.621371).toFixed(0)} mph`, type: "range" },
    { name: "Inversions", key: "inversions", metricUnit: "", imperialUnit: "", metricFormat: (v) => `${v}`, imperialFormat: (v) => `${v}`, type: "range" },
    { name: "Year Opened", key: "year", metricUnit: "", imperialUnit: "", metricFormat: (v) => `${v}`, imperialFormat: (v) => `${v}`, type: "range" },
    { name: "Track Length", key: "length", metricUnit: "meters", imperialUnit: "feet", metricFormat: (v) => `${v}m`, imperialFormat: (v) => `${(v * 3.28084).toFixed(0)}ft`, type: "range" },
    { name: "Park", key: "park", metricUnit: "", imperialUnit: "", metricFormat: (v) => v, imperialFormat: (v) => v, type: "range" },
    { name: "Tallest Coaster", key: "height", metricUnit: "meters", imperialUnit: "feet", metricFormat: (v) => `${v}m`, imperialFormat: (v) => `${(v * 3.28084).toFixed(0)}ft`, type: "landmark" },
    { name: "Fastest Coaster", key: "speed", metricUnit: "km/h", imperialUnit: "mph", metricFormat: (v) => `${v} km/h`, imperialFormat: (v) => `${(v * 0.621371).toFixed(0)} mph`, type: "landmark" },
    { name: "Most Inversions", key: "inversions", metricUnit: "", imperialUnit: "", metricFormat: (v) => `${v}`, imperialFormat: (v) => `${v}`, type: "landmark" },
    { name: "Longest Coaster", key: "length", metricUnit: "meters", imperialUnit: "feet", metricFormat: (v) => `${v}m`, imperialFormat: (v) => `${(v * 3.28084).toFixed(0)}ft`, type: "landmark" }
];

function hasValidValue(coaster, key) {
    const value = coaster.stats?.[key];
    return value !== null && value !== undefined && value !== 0 && value !== '';
}

function selectRandomCoasters() {
    const shuffled = [...gameCoasters].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
}

function selectCriterion(coasters, roundNumber, useImperial, difficultyMode) {
    const isLandmarkRound = (roundNumber % 4 === 0) && roundNumber > 0;
    
    let applicableCriteria = criteriaTypes;
    if (isLandmarkRound) {
        applicableCriteria = criteriaTypes.filter(c => c.type === 'landmark');
    } else {
        applicableCriteria = criteriaTypes.filter(c => c.type === 'range');
    }
    
    const shuffledCriteria = [...applicableCriteria].sort(() => Math.random() - 0.5);
    
    let progressionRounds = 10;
    if (difficultyMode === 'medium') progressionRounds = 5;
    if (difficultyMode === 'hard') progressionRounds = 0;
    
    const rawDifficulty = Math.min(roundNumber / progressionRounds, 1);
    
    for (const criteriaType of shuffledCriteria) {
        const allHaveValues = coasters.every(c => hasValidValue(c, criteriaType.key));
        
        if (!allHaveValues) continue;
        
        if (isLandmarkRound) {
            let targetCoaster = null;
            if (criteriaType.name === 'Tallest Coaster' || criteriaType.name === 'Fastest Coaster' || 
                criteriaType.name === 'Most Inversions' || criteriaType.name === 'Longest Coaster') {
                targetCoaster = coasters.reduce((max, c) => 
                    c.stats[criteriaType.key] > max.stats[criteriaType.key] ? c : max
                );
            }
            
            if (targetCoaster) {
                return {
                    type: criteriaType.name,
                    key: criteriaType.key,
                    value: targetCoaster.stats[criteriaType.key],
                    metricFormat: criteriaType.metricFormat,
                    imperialFormat: criteriaType.imperialFormat,
                    correctCoasterId: targetCoaster.id,
                    isLandmark: true
                };
            }
        } else {
            const maxAttempts = 50;
            
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const targetCoaster = coasters[Math.floor(Math.random() * coasters.length)];
                const targetValue = targetCoaster.stats[criteriaType.key];
                
                const values = coasters.map(c => c.stats[criteriaType.key]).sort((a, b) => a - b);
                const minVal = Math.min(...values);
                const maxVal = Math.max(...values);
                const range = maxVal - minVal;
                
                let tolerance = range;
                
                if (criteriaType.key === 'length') {
                    tolerance = range * (0.5 - (rawDifficulty * 0.45));
                } else if (criteriaType.key === 'height') {
                    tolerance = range * (0.4 - (rawDifficulty * 0.35));
                } else if (criteriaType.key === 'speed') {
                    tolerance = range * (0.45 - (rawDifficulty * 0.40));
                } else if (criteriaType.key === 'inversions') {
                    tolerance = range * (0.3 - (rawDifficulty * 0.25));
                } else if (criteriaType.key === 'year') {
                    tolerance = range * (0.3 - (rawDifficulty * 0.25));
                } else if (criteriaType.key === 'park') {
                    tolerance = range;
                }
                
                const withinTolerance = coasters.filter(c => 
                    Math.abs(c.stats[criteriaType.key] - targetValue) <= tolerance
                );
                
                if (withinTolerance.length === 1) {
                    return {
                        type: criteriaType.name,
                        key: criteriaType.key,
                        value: targetValue,
                        metricFormat: criteriaType.metricFormat,
                        imperialFormat: criteriaType.imperialFormat,
                        correctCoasterId: targetCoaster.id,
                        isLandmark: false
                    };
                }
            }
        }
    }
    
    return null;
}

io.on('connection', (socket) => {
    console.log('A user connected');

    const userId = nextUserId++;
    socketToUserId[socket.id] = userId;
    userIdToSocket[userId] = socket.id;
    console.log(`Assigned user ID: ${userId}`);
    
    let currentRoom = null;

    socket.emit('userIdAssigned', userId);

    const updateRoomUsers = (roomCode) => {
        const socketIds = Array.from(io.sockets.adapter.rooms.get(roomCode) || []);
        const userIds = socketIds.map(socketId => socketToUserId[socketId]);
        const config = roomConfigs[roomCode] || {};
        const usersWithNames = userIds.map(id => ({
            userId: id,
            username: usernames[id] || `User ${id}`,
            isHost: id === roomHosts[roomCode],
            hp: roomGameData[roomCode]?.playerHP?.[id] ?? config.startingHealth ?? DEFAULT_STARTING_HP
        }));
        
        io.to(roomCode).emit('roomUsersUpdate', {
            users: usersWithNames,
            roomLimit: config.maxPlayers || 3,
            currentCount: userIds.length,
            gameState: roomGameStates[roomCode] || 'lobby',
            startingHealth: config.startingHealth,
            roundTime: config.roundTime / 1000,
            useImperial: config.useImperial || true,
            isPublic: config.isPublic || false
        });
        
        if (config.isPublic && userIds.length >= config.maxPlayers) {
            const hasAvailable = publicRooms.some(code => {
                const count = roomUsers[code]?.length || 0;
                const max = roomConfigs[code]?.maxPlayers || 8;
                const state = roomGameStates[code];
                return count < max && state === 'lobby' && code !== roomCode;
            });
            
            if (!hasAvailable) {
                createPublicRoom();
            }
        }
    };

    const assignNewHost = (roomCode) => {
        if (roomUsers[roomCode] && roomUsers[roomCode].length > 0) {
            const newHostId = roomUsers[roomCode][0];
            roomHosts[roomCode] = newHostId;
            const newHostName = usernames[newHostId] || `User ${newHostId}`;
            io.to(roomCode).emit('newHostAssigned', newHostId);
            io.to(roomCode).emit('chatMessage', { 
                userId: 'System', 
                username: 'System',
                message: `${newHostName} is now the host!` 
            });
            updateRoomUsers(roomCode);
            console.log(`User ID ${newHostId} (${newHostName}) is now the host of room ${roomCode}`);
        } else {
            cleanupRoom(roomCode);
        }
    };

    const cleanupRoom = (roomCode) => {
        const isPublic = roomConfigs[roomCode]?.isPublic;
        
        const gameData = roomGameData[roomCode];
        if (gameData?.roundTimer) {
            clearTimeout(gameData.roundTimer);
        }
        
        delete roomHosts[roomCode];
        delete roomUsers[roomCode];
        delete roomConfigs[roomCode];
        delete roomGameStates[roomCode];
        delete roomGameData[roomCode];
        
        if (isPublic) {
            publicRooms = publicRooms.filter(code => code !== roomCode);
            console.log(`Public room ${roomCode} has been cleaned up (empty)`);
            
            const hasAvailable = publicRooms.some(code => {
                const count = roomUsers[code]?.length || 0;
                const max = roomConfigs[code]?.maxPlayers || 8;
                const state = roomGameStates[code];
                return count < max && state === 'lobby';
            });
            
            if (!hasAvailable) {
                createPublicRoom();
            }
        } else {
            console.log(`Room ${roomCode} has been cleaned up (empty)`);
        }
    };

    socket.on('setUsername', (username) => {
        if (!username || username.trim().length === 0) {
            socket.emit('error', 'Please enter a username!');
            return;
        }
        
        const trimmedUsername = username.trim().substring(0, 20);
        usernames[userId] = trimmedUsername;
        socket.emit('usernameSet', trimmedUsername);
        console.log(`User ID ${userId} set username to: ${trimmedUsername}`);
        
        if (currentRoom) {
            updateRoomUsers(currentRoom);
            io.to(currentRoom).emit('chatMessage', { 
                userId: 'System',
                username: 'System', 
                message: `${trimmedUsername} updated their username` 
            });
        }
    });

    socket.on('quickQueue', () => {
        if (!usernames[userId]) {
            socket.emit('error', 'Please enter a username!');
            return;
        }

        if (currentRoom) {
            socket.leave(currentRoom);
            roomUsers[currentRoom] = roomUsers[currentRoom].filter(id => id !== userId);
            if (roomUsers[currentRoom].length === 0) {
                cleanupRoom(currentRoom);
            } else {
                if (roomHosts[currentRoom] === userId) {
                    assignNewHost(currentRoom);
                }
                updateRoomUsers(currentRoom);
            }
        }

        const roomCode = getAvailablePublicRoom();
        socket.join(roomCode);
        currentRoom = roomCode;

        if (!roomUsers[roomCode]) {
            roomUsers[roomCode] = [];
        }
        
        if (!roomHosts[roomCode] || roomUsers[roomCode].length === 0) {
            roomHosts[roomCode] = userId;
            console.log(`User ID ${userId} (${usernames[userId]}) is now the host of public room ${roomCode}`);
        }
        
        roomUsers[roomCode].push(userId);
        
        const config = roomConfigs[roomCode];
        if (!roomGameData[roomCode]) {
            roomGameData[roomCode] = { playerHP: {} };
        }
        roomGameData[roomCode].playerHP[userId] = config.startingHealth;
        
        updateRoomUsers(roomCode);

        socket.emit('joinedRoom', { 
            roomCode,
            gameState: roomGameStates[roomCode] || 'lobby',
            isPublic: true
        });
        
        console.log(`User ID ${userId} (${usernames[userId]}) quick queued into room: ${roomCode}`);
        io.to(roomCode).emit('chatMessage', { 
            userId: 'System',
            username: 'System', 
            message: `${usernames[userId]} joined the room!` 
        });
    });

    socket.on('createRoom', (config) => {
        if (!usernames[userId]) {
            socket.emit('error', 'Please enter a username!');
            return;
        }

        const maxPlayers = config?.maxPlayers || 3;
        const startingHealth = config?.startingHealth || DEFAULT_STARTING_HP;
        const roundTime = config?.roundTime || DEFAULT_ROUND_TIME;
        const useImperial = config?.useImperial !== undefined ? config.useImperial : true;

        if (maxPlayers < 2 || maxPlayers > 8) {
            socket.emit('error', 'Max Players must be between 2 and 8.');
            return;
        }

        if (currentRoom) {
            socket.leave(currentRoom);
            roomUsers[currentRoom] = roomUsers[currentRoom].filter(id => id !== userId);
            if (roomUsers[currentRoom].length === 0) {
                cleanupRoom(currentRoom);
            } else {
                if (roomHosts[currentRoom] === userId) {
                    assignNewHost(currentRoom);
                }
                updateRoomUsers(currentRoom);
            }
        }

        const roomCode = generateRoomCode();
        socket.join(roomCode);
        currentRoom = roomCode;

        roomConfigs[roomCode] = { maxPlayers, startingHealth, roundTime, useImperial, isPublic: false };
        roomUsers[roomCode] = [userId];
        roomHosts[roomCode] = userId;
        roomGameStates[roomCode] = 'lobby';
        roomGameData[roomCode] = {
            playerHP: { [userId]: startingHealth }
        };
        
        updateRoomUsers(roomCode);

        socket.emit('roomCreated', { roomCode, isHost: true });
        console.log(`User ID ${userId} (${usernames[userId]}) created room: ${roomCode}`);
    });

    socket.on('updateGameSettings', (settings) => {
        if (!currentRoom) {
            socket.emit('error', 'You are not in a room.');
            return;
        }

        if (userId !== roomHosts[currentRoom]) {
            socket.emit('error', 'Only the room host can change settings.');
            return;
        }

        const config = roomConfigs[currentRoom];
        const currentPlayerCount = roomUsers[currentRoom].length;

        if (settings.maxPlayers !== undefined) {
            if (!config.isPublic || currentPlayerCount === 1) {
                const newMax = Math.max(currentPlayerCount, settings.maxPlayers);
                config.maxPlayers = newMax;
            }
        }

        if (settings.startingHealth !== undefined) {
            config.startingHealth = settings.startingHealth;
        }

        if (settings.roundTime !== undefined) {
            config.roundTime = settings.roundTime;
        }

        if (settings.useImperial !== undefined) {
            config.useImperial = settings.useImperial;
        }

        if (settings.difficultyMode !== undefined) {
            config.difficultyMode = settings.difficultyMode;
        }

        updateRoomUsers(currentRoom);
        console.log(`Settings updated for room ${currentRoom}:`, config);
    });

    socket.on('startGame', () => {
        if (!currentRoom) {
            socket.emit('error', 'You are not in a room.');
            return;
        }

        if (userId !== roomHosts[currentRoom]) {
            socket.emit('error', 'Only the room host can start the game.');
            return;
        }

        if (roomGameStates[currentRoom] === 'playing') {
            socket.emit('error', 'Game is already in progress.');
            return;
        }

        if (roomUsers[currentRoom].length < 2) {
            socket.emit('error', 'Need at least 2 players to start.');
            return;
        }

        roomGameStates[currentRoom] = 'playing';
        
        const config = roomConfigs[currentRoom];
        const playerHP = {};
        roomUsers[currentRoom].forEach(id => {
            playerHP[id] = config.startingHealth;
        });

        roomGameData[currentRoom] = {
            playerHP,
            roundNumber: 0,
            roundActive: false,
            roundTime: config.roundTime,
            useImperial: config.useImperial,
            difficultyMode: config.difficultyMode || 'medium'
        };

        io.to(currentRoom).emit('gameStarted', {
            message: `Game started in room ${currentRoom}!`
        });
        
        updateRoomUsers(currentRoom);
        console.log(`Game started in room ${currentRoom}`);

        setTimeout(() => startNewRound(currentRoom), 2000);
    });

    function startNewRound(roomCode) {
        if (roomGameStates[roomCode] !== 'playing') return;

        const gameData = roomGameData[roomCode];
        if (!gameData) return;
        
        gameData.roundNumber++;
        gameData.roundActive = true;
        
        let roundCoasters = null;
        let roundCriterion = null;
        
        for (let attempt = 0; attempt < 20; attempt++) {
            roundCoasters = selectRandomCoasters();
            roundCriterion = selectCriterion(roundCoasters, gameData.roundNumber, gameData.useImperial, gameData.difficultyMode);
            
            if (roundCriterion) {
                break;
            }
        }
        
        if (!roundCriterion) {
            console.log(`Could not find valid criterion for round ${gameData.roundNumber}, retrying...`);
            setTimeout(() => startNewRound(roomCode), 2000);
            return;
        }

        gameData.roundCoasters = roundCoasters;
        gameData.roundCriterion = roundCriterion;
        gameData.playerAnswers = {};
        gameData.roundStartTime = Date.now();

        const criterion = gameData.roundCriterion;
        const displayValue = gameData.useImperial ? criterion.imperialFormat(criterion.value) : criterion.metricFormat(criterion.value);

        io.to(roomCode).emit('newRound', {
            roundNumber: gameData.roundNumber,
            coasters: gameData.roundCoasters.map(c => ({
                id: c.id,
                name: c.name,
                park: c.park,
                image: c.image,
                mainPicture: c.mainPicture
            })),
            criterion: {
                type: criterion.type,
                displayValue: displayValue
            },
            timeLimit: gameData.roundTime
        });

        gameData.roundTimer = setTimeout(() => {
            endRound(roomCode);
        }, gameData.roundTime);
    }

    function endRound(roomCode) {
        const gameData = roomGameData[roomCode];
        if (!gameData || !gameData.roundActive) return;

        clearTimeout(gameData.roundTimer);
        gameData.roundActive = false;

        const correctCoasterId = gameData.roundCriterion.correctCoasterId;
        const correctCoaster = gameData.roundCoasters.find(c => c.id === correctCoasterId);
        const results = [];

        roomUsers[roomCode].forEach(playerId => {
            const answer = gameData.playerAnswers[playerId];
            const isCorrect = answer === correctCoasterId;
            const tooSlow = !answer;

            if (!isCorrect || tooSlow) {
                gameData.playerHP[playerId]--;
            }

            if (!gameData.playerStreaks) gameData.playerStreaks = {};
            if (!gameData.playerStreaks[playerId]) gameData.playerStreaks[playerId] = 0;
            
            if (isCorrect && !tooSlow) {
                gameData.playerStreaks[playerId]++;
            } else {
                gameData.playerStreaks[playerId] = 0;
            }

            results.push({
                userId: playerId,
                username: usernames[playerId],
                answer: answer,
                answeredCoaster: answer ? gameData.roundCoasters.find(c => c.id === answer) : null,
                isCorrect,
                tooSlow,
                hp: gameData.playerHP[playerId],
                streak: gameData.playerStreaks[playerId]
            });
        });

        const allCoastersWithStats = gameData.roundCoasters.map(coaster => ({
            ...coaster,
            stats: coaster.stats || {}
        }));

        io.to(roomCode).emit('roundEnded', {
            correctCoasterId,
            correctCoaster,
            allCoasters: allCoastersWithStats,
            results,
            criterion: {
                key: gameData.roundCriterion.key,
                type: gameData.roundCriterion.type
            },
            isLandmark: gameData.roundCriterion.isLandmark
        });

        updateRoomUsers(roomCode);

        const alivePlayers = roomUsers[roomCode].filter(id => gameData.playerHP[id] > 0);
        
        if (alivePlayers.length === 0) {
            setTimeout(() => {
                io.to(roomCode).emit('gameEnded', {
                    message: 'Game over! Nobody won!',
                    winner: null
                });
                roomGameStates[roomCode] = 'lobby';
            }, 5000);
        } else if (alivePlayers.length === 1) {
            setTimeout(() => {
                io.to(roomCode).emit('gameEnded', {
                    message: `${usernames[alivePlayers[0]]} wins!`,
                    winner: {
                        userId: alivePlayers[0],
                        username: usernames[alivePlayers[0]]
                    }
                });
                roomGameStates[roomCode] = 'lobby';
            }, 5000);
        } else {
            setTimeout(() => startNewRound(roomCode), 5000);
        }
    }

    socket.on('submitAnswer', (coasterId) => {
        if (!currentRoom) {
            socket.emit('error', 'You are not in a room!');
            return;
        }

        const gameData = roomGameData[currentRoom];
        if (!gameData || !gameData.roundActive) {
            socket.emit('error', 'No active round!');
            return;
        }

        if (gameData.playerHP[userId] <= 0) {
            socket.emit('error', 'You are eliminated!');
            return;
        }

        if (gameData.playerAnswers[userId]) {
            socket.emit('error', 'You already answered this round!');
            return;
        }

        gameData.playerAnswers[userId] = coasterId;

        io.to(currentRoom).emit('playerAnswered', {
            userId,
            username: usernames[userId]
        });

        const alivePlayers = roomUsers[currentRoom].filter(id => gameData.playerHP[id] > 0);
        const allAnswered = alivePlayers.every(id => gameData.playerAnswers[id]);

        if (allAnswered) {
            clearTimeout(gameData.roundTimer);

            gameData.roundTimer = setTimeout(() => {
                endRound(currentRoom);
            }, 1000);
        }
    });

    socket.on('endGame', () => {
        if (!currentRoom) {
            socket.emit('error', 'You are not in a room.');
            return;
        }

        if (userId !== roomHosts[currentRoom]) {
            socket.emit('error', 'Only the room host can end the game.');
            return;
        }

        if (roomGameStates[currentRoom] !== 'playing') {
            socket.emit('error', 'No game is currently in progress.');
            return;
        }

        const gameData = roomGameData[currentRoom];
        if (gameData && gameData.roundTimer) {
            clearTimeout(gameData.roundTimer);
        }

        roomGameStates[currentRoom] = 'lobby';
        
        io.to(currentRoom).emit('gameEnded', {
            message: 'Game has been ended by the host.',
            winner: null
        });
        
        updateRoomUsers(currentRoom);
        console.log(`Game ended in room ${currentRoom}`);
    });

    socket.on('joinRoom', (roomCode) => {
        if (!usernames[userId]) {
            socket.emit('error', 'Please set a username first');
            return;
        }

        if (!roomCode || !roomCode.trim()) {
            socket.emit('error', 'Please enter a room code');
            return;
        }

        const room = io.sockets.adapter.rooms.get(roomCode);
        if (!room) {
            socket.emit('error', 'Room not found!');
            return;
        }

        if (currentRoom === roomCode) {
            console.log(`User ID ${userId} already in room: ${roomCode}`);
            socket.emit('roomAlreadyJoined', roomCode);
            return;
        }

        if (roomGameStates[roomCode] === 'playing') {
            socket.emit('error', 'Game is in progress. Cannot join right now.');
            return;
        }

        if (currentRoom) {
            socket.leave(currentRoom);
            roomUsers[currentRoom] = roomUsers[currentRoom].filter(id => id !== userId);
            if (roomUsers[currentRoom].length === 0) {
                cleanupRoom(currentRoom);
            } else {
                if (roomHosts[currentRoom] === userId) {
                    assignNewHost(currentRoom);
                }
                updateRoomUsers(currentRoom);
            }
        }

        if (roomConfigs[roomCode] === undefined) {
            socket.emit('error', 'Room configuration error!');
            return;
        }

        if (roomUsers[roomCode].length >= roomConfigs[roomCode].maxPlayers) {
            socket.emit('error', 'This room is full!');
            return;
        }

        socket.join(roomCode);
        currentRoom = roomCode;

        if (!roomUsers[roomCode]) {
            roomUsers[roomCode] = [];
        }
        
        if (!roomHosts[roomCode] || roomUsers[roomCode].length === 0) {
            roomHosts[roomCode] = userId;
            console.log(`User ID ${userId} (${usernames[userId]}) is now the host of room ${roomCode}`);
        }

        roomUsers[roomCode].push(userId);
        
        const config = roomConfigs[roomCode];
        if (!roomGameData[roomCode]) {
            roomGameData[roomCode] = { playerHP: {} };
        }
        roomGameData[roomCode].playerHP[userId] = config.startingHealth;
        
        updateRoomUsers(roomCode);

        socket.emit('joinedRoom', { 
            roomCode,
            gameState: roomGameStates[roomCode] || 'lobby',
            isPublic: config.isPublic || false
        });
        
        console.log(`User ID ${userId} (${usernames[userId]}) joined room: ${roomCode}`);
        io.to(roomCode).emit('chatMessage', { 
            userId: 'System',
            username: 'System', 
            message: `+ ${usernames[userId]} joined the room!` 
        });
    });    

    socket.on('leaveRoom', () => {
        if (!currentRoom) {
            socket.emit('error', 'You are not in a room!');
            return;
        }

        const leavingUsername = usernames[userId] || `User ${userId}`;
        socket.leave(currentRoom);
        roomUsers[currentRoom] = roomUsers[currentRoom].filter(id => id !== userId);

        if (roomUsers[currentRoom].length === 0) {
            cleanupRoom(currentRoom);
        } else {
            if (roomHosts[currentRoom] === userId) {
                assignNewHost(currentRoom);
            }
            updateRoomUsers(currentRoom);
            io.to(currentRoom).emit('chatMessage', { 
                userId: 'System',
                username: 'System', 
                message: `- ${leavingUsername} left the room!` 
            });
        }

        currentRoom = null;
        socket.emit('leftRoom');
    });

    socket.on('disconnect', () => {
        if (currentRoom) {
            const disconnectUsername = usernames[userId] || `User ${userId}`;
            socket.leave(currentRoom);
            roomUsers[currentRoom] = roomUsers[currentRoom].filter(id => id !== userId);

            if (roomUsers[currentRoom].length === 0) {
                cleanupRoom(currentRoom);
            } else {
                if (roomHosts[currentRoom] === userId) {
                    assignNewHost(currentRoom);
                }
                updateRoomUsers(currentRoom);
                io.to(currentRoom).emit('chatMessage', { 
                    userId: 'System',
                    username: 'System', 
                    message: `- ${disconnectUsername} has disconnected! 😭` 
                });
            }
        }
        
        delete socketToUserId[socket.id];
        delete userIdToSocket[userId];
        delete usernames[userId];
        console.log(`User ID ${userId} disconnected`);
    });

    socket.on('chatMessage', (message) => {
        if (!currentRoom) {
            socket.emit('error', 'You are not in a room!');
            return;
        }
        
        const username = usernames[userId] || `User ${userId}`;
        io.to(currentRoom).emit('chatMessage', { 
            userId, 
            username,
            message 
        });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is up and running on port ${PORT}!`);

});
