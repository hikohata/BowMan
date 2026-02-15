// キャンバスとコンテキストの取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 画像の読み込み (User fixed path to jpg)
const titleImage = new Image();
titleImage.src = 'bow_man_title.jpg';

// ゲーム設定
const CONFIG = {
    canvasWidth: 800,
    canvasHeight: 600,
    gravity: 0.1, // 重力
    // Wind is now fixed per stage
    screenLoop: true, // 画面ループ有効
    initialPlayers: 1, // 初期人間プレイヤー数
    initialComputers: 1 // 初期CPU数
};

// ゲームの状態定義
const GameState = {
    TITLE: 'TITLE',
    GAME_LOOP: 'GAME_LOOP',
    SHOP: 'SHOP',
    RESULT: 'RESULT'
};

// アイテム定義
const ITEMS = {
    'NORMAL': { name: 'Normal Arrow', price: 0, type: 'NORMAL' },
    'FIRE': { name: 'Fire Arrow', price: 150, type: 'FIRE' },
    'BOMB': { name: 'Bomb Arrow', price: 300, type: 'BOMB' },
    'HEALTH': { name: 'Health Pack', price: 200, type: 'HEALTH' },
    'TRIPLE': { name: 'Triple Arrow', price: 250, type: 'TRIPLE' },
    'LASER': { name: 'Laser Arrow', price: 400, type: 'LASER' }
};

// 現在の状態
let currentState = GameState.TITLE;

// 入力状態
const input = {
    keys: {},
    prevKeys: {} // 前フレームのキー状態
};

// ゲームエンティティ
let terrain = null;
let players = [];
let projectiles = [];
let particles = [];
let fires = []; // 炎オブジェクト
let currentPlayerIndex = 0;
let wind = 0;
let isTurnActive = true;
let bgGradient = null;
let cpuThinking = false; // CPU思考中フラグ
let hasActionTaken = false; // Add action taken flag
let cpuTurnTimeout = null; // Add timeout reference

// タイトル画面用設定
let settingHumans = 1;
let settingCPUs = 1;

// ショップ用状態
let shopCursor = 0; // 選択中のプレイヤーインデックス

// サウンドマネージャー
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const Sound = {
    shoot: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    },
    hit: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.type = 'square'; // 爆発っぽい矩形波
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    },
    heal: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(400, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(600, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    }
};

// ---------------------------------------------------------
// クラス定義
// ---------------------------------------------------------

/**
 * 地形クラス
 */
class Terrain {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.data = new Float32Array(width);
        this.generate();
    }

    generate() {
        const baseHeight = this.height * 0.7;
        let noiseOffset = Math.random() * 1000;
        for (let x = 0; x < this.width; x++) {
            const y1 = Math.sin((x + noiseOffset) * 0.01) * 50;
            const y2 = Math.sin((x + noiseOffset) * 0.05) * 20;
            const y3 = Math.sin((x + noiseOffset) * 0.1) * 5;
            this.data[x] = baseHeight + y1 + y2 + y3;
        }
    }

    getHeight(x) {
        if (x < 0) x = 0;
        if (x >= this.width) x = this.width - 1;
        return this.data[Math.floor(x)];
    }

    destroy(cx, cy, radius) {
        // 破壊半径の調整（仕様変更対応）
        const startX = Math.floor(cx - radius);
        const endX = Math.ceil(cx + radius);

        for (let x = startX; x <= endX; x++) {
            let targetX = x;
            if (CONFIG.screenLoop) {
                if (targetX < 0) targetX += this.width;
                if (targetX >= this.width) targetX -= this.width;
            } else {
                if (targetX < 0 || targetX >= this.width) continue;
            }

            const dx = x - cx;
            const distSq = dx * dx;
            if (distSq < radius * radius) {
                const dy = Math.sqrt(radius * radius - distSq);
                const craterBottomY = cy + dy;

                if (this.data[targetX] < craterBottomY) {
                    this.data[targetX] = craterBottomY;
                }
            }
        }
    }

    draw(ctx) {
        ctx.fillStyle = '#228B22';
        ctx.beginPath();
        ctx.moveTo(0, this.height);
        for (let x = 0; x < this.width; x++) {
            ctx.lineTo(x, this.data[x]);
        }
        ctx.lineTo(this.width, this.height);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#006400';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
}

/**
 * 炎クラス (パーティクルで表現)
 */
class Fire {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        // life removed for persistence
        this.frame = 0;
        this.particles = [];
    }

    update(terrain) {
        // this.life--; // Removed for persistence
        this.frame++;

        // 地面に追従
        const groundY = terrain.getHeight(this.x);
        this.y = groundY;

        // パーティクル生成
        if (this.frame % 5 === 0) {
            this.particles.push({
                x: this.x + (Math.random() * 10 - 5),
                y: this.y,
                vx: (Math.random() - 0.5) * 0.5,
                vy: -Math.random() * 2 - 1, // 上昇
                life: 30,
                color: Math.random() > 0.5 ? 'orange' : 'red'
            });
        }

        // パーティクル更新
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        // ダメージ判定は削除 (ターン終了時に判定)
    }

    draw(ctx) {
        ctx.globalCompositeOperation = 'lighter'; // 加算合成で炎っぽく
        this.particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.life / 30;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';
    }
}

/**
 * 弾丸クラス
 */
class Projectile {
    constructor(x, y, vx, vy, ownerId, type) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.ownerId = ownerId;
        this.type = type || 'NORMAL';
        this.radius = 3;
        this.isActive = true;
        this.rotation = Math.atan2(vy, vx);
        this.invincibility = 10; // Frames to ignore shooter collision (self-hit)
    }

    update() {
        if (!this.isActive) return;

        if (this.invincibility > 0) this.invincibility--;
        if (this.type !== 'LASER') {
            this.vy += CONFIG.gravity;
            this.vx += wind; // 風の影響
        }
        this.x += this.vx;
        this.y += this.vy;

        // 速度から角度を更新
        this.rotation = Math.atan2(this.vy, this.vx);

        if (this.type === 'LASER') {
            // Laser Bounce Logic
            if (this.x < 0 || this.x > CONFIG.canvasWidth) {
                this.vx *= -1;
                this.x += this.vx;
                this.rotation = Math.atan2(this.vy, this.vx);
            }
            if (this.y < 0) {
                this.vy *= -1;
                this.y += this.vy;
                this.rotation = Math.atan2(this.vy, this.vx);
            }

            // Laser Lifespan (to prevent infinite bouncing)
            if (!this.life) this.life = 300; // 5 seconds approx
            this.life--;
            if (this.life <= 0) this.isActive = false;
        } else if (CONFIG.screenLoop) {
            if (this.x < 0) this.x += CONFIG.canvasWidth;
            if (this.x >= CONFIG.canvasWidth) this.x -= CONFIG.canvasWidth;
        }

        if (this.y > CONFIG.canvasHeight) {
            this.isActive = false;
        }

        let checkX = this.x;
        if (checkX < 0) checkX = 0;
        if (checkX >= CONFIG.canvasWidth) checkX = CONFIG.canvasWidth - 1;

        const groundY = terrain.getHeight(checkX);
        if (this.y >= groundY) {
            this.explode(checkX, groundY);
        }

        for (let p of players) {
            if (p.hp > 0 &&
                Math.abs(this.x - p.x) < p.width / 2 + this.radius &&
                Math.abs(this.y - (p.y - p.height / 2)) < p.height / 2 + this.radius) {

                // Ignore shooter if recently fired
                if (p.id === this.ownerId && this.invincibility > 0) continue;

                this.explode(this.x, this.y);
                break;
            }
        }
    }

    explode(x, y) {
        this.isActive = false;
        Sound.hit(); // 効果音

        particles.push(new Explosion(x, y, 30));

        let explosionRadius = 20;
        let damageMultiplier = 1.0;

        if (this.type === 'BOMB') {
            explosionRadius = 80;
            damageMultiplier = 1.5;
            particles.push(new Explosion(x, y, 60));
        } else if (this.type === 'FIRE') {
            explosionRadius = 15;
            for (let i = 0; i < 5; i++) {
                fires.push(new Fire(x + (Math.random() * 20 - 10), y));
            }
        } else {
            // NORMAL
            explosionRadius = 10;
        }

        terrain.destroy(x, y, explosionRadius);

        // ダメージ判定
        players.forEach(p => {
            const dx = Math.abs(x - p.x);
            const distX = CONFIG.screenLoop ? Math.min(dx, CONFIG.canvasWidth - dx) : dx;
            const distY = Math.abs(y - (p.y - p.height / 2));
            const dist = Math.sqrt(distX * distX + distY * distY);

            if (dist < explosionRadius * 2.0 + 20) {
                let damage = 0;
                const damageRadius = explosionRadius * 2.0 + 20;
                damage = Math.floor(50 * damageMultiplier * (1 - dist / damageRadius));

                if (damage > 0) {
                    p.takeDamage(damage);

                    // Check if fatal kill (need to check if p died JUST NOW)
                    // But updateGame handles death transition.
                    // However, we want to give money immediately?
                    // No, updateGame checks `hp <= 0 && isTurnActive`.
                    // Does Projectile.explode run BEFORE updateGame check?
                    // Yes. p.takeDamage reduces HP.
                    // If HP becomes <= 0, `updateGame` will see it.
                    // BUT, `updateGame` handles "Falling Death" specifically?
                    // It says "Falling/HP0".
                    // `if (p.hp <= 0 && isTurnActive)`
                    // This block runs if CURRENT PLAYER is dead.

                    // ISSUE: If I shoot YOU and YOU die, `p` in updateGame is ME.
                    // `p` in updateGame loop is `players[currentPlayerIndex]`.
                    // If *I* (current player) kill *YOU* (target), *YOU* are dead.
                    // But `updateGame` logic only checks if *current player* is dead?
                    // Wait, let's check `updateGame` again.
                    // Line 1037: `const p = players[currentPlayerIndex]; ... if (p.hp <= 0 ...)`
                    // This only ends turn if *current player* dies (e.g. suicide/falling).

                    // What if I kill ENEMY?
                    // `nextTurn` logic: `do { currentPlayerIndex++ } while (players[currentPlayerIndex].hp <= 0);`
                    // It just skips dead players.
                    // But we want to give money to the dead guy (Rank Reward).

                    // So we must detect death HERE in explode?
                    // Or in a general "check deaths" function.

                    if (p.hp <= 0) {
                        // Check if this is the first time we realized they are dead?
                        // We don't want to give money repeatedly.
                        // Maybe check `p.hp <= 0` but `p.isDead` flag?
                        // Add `isDead` property to Player?
                        if (!p.isDead) {
                            p.isDead = true;
                            const survivors = players.filter(pl => pl.hp > 0).length;
                            const rank = survivors + 1;
                            let reward = 100;
                            if (rank === 2) reward = 500;
                            else if (rank === 3) reward = 300;
                            else if (rank === 4) reward = 200;
                            console.log(`Player ${p.id} died (Hit). Rank ${rank}. Reward: $${reward}`);
                            p.money += reward;
                        }
                    }
                }
            }
        });
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        ctx.beginPath();

        if (this.type === 'LASER') {
            // Laser drawing
            ctx.strokeStyle = '#00FF00'; // Lime Green
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#00FF00';
            ctx.lineWidth = 4;
            ctx.moveTo(-20, 0); // Longer beam
            ctx.lineTo(20, 0);
            ctx.stroke();
            ctx.shadowBlur = 0; // Reset shadow
        } else {
            // Normal arrow drawing
            // 軸
            ctx.moveTo(-10, 0);
            ctx.lineTo(10, 0);
            // 先端
            ctx.lineTo(5, -3);
            ctx.moveTo(10, 0);
            ctx.lineTo(5, 3);
            // 羽根
            ctx.moveTo(-10, 0);
            ctx.lineTo(-15, -3);
            ctx.moveTo(-10, 0);
            ctx.lineTo(-15, 3);

            if (this.type === 'NORMAL') ctx.strokeStyle = 'white';
            else if (this.type === 'FIRE') ctx.strokeStyle = 'red';
            else if (this.type === 'BOMB') ctx.strokeStyle = 'black';
            else if (this.type === 'TRIPLE') ctx.strokeStyle = 'cyan';

            ctx.lineWidth = 2;
            ctx.stroke();
        }

        ctx.restore();
    }
}

/**
 * 爆発エフェクト
 */
class Explosion {
    constructor(x, y, maxRadius = 30) {
        this.x = x;
        this.y = y;
        this.radius = 1;
        this.maxRadius = maxRadius;
        this.alpha = 1.0;
        this.isActive = true;
    }

    update() {
        this.radius += this.maxRadius / 15;
        this.alpha -= 0.05;
        if (this.alpha <= 0) {
            this.isActive = false;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'orange';
        ctx.fill();
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * プレイヤークラス
 */
class Player {
    constructor(id, color, x, isCPU = false) {
        this.id = id;
        this.color = color;
        this.x = x;
        // Spawn on ground immediately
        this.y = terrain ? terrain.getHeight(x) : 0;
        this.width = 20;
        this.height = 30; // 判定用サイズ
        this.hp = 100;
        this.prevHp = 100; // 前ターンのHP (被弾判定用)
        this.angle = isCPU ? Math.floor(Math.random() * 180) : 45;
        this.power = isCPU ? 30 + Math.floor(Math.random() * 50) : 50;
        this.moveSpeed = 2;
        this.fuel = 10; // 初期燃料
        this.money = 0;
        this.isCPU = isCPU;
        this.isStable = true; // 着地しているか
        this.isDead = false;

        this.inventory = {
            'FIRE': 0,
            'BOMB': 0,
            'HEALTH': 0,
            'TRIPLE': 0,
            'LASER': 0
        };
        this.currentWeapon = 'NORMAL';
    }

    update(terrain) {
        const groundY = terrain.getHeight(this.x);

        if (this.y < groundY) {
            this.y += 2;
            if (this.y > groundY) this.y = groundY;
            this.isStable = (this.y >= groundY);
        } else {
            this.y = groundY;
            this.isStable = true;
        }

        if (this.y >= CONFIG.canvasHeight - 10) {
            this.hp = 0;
        }
    }

    draw(ctx, isActive) {
        if (this.hp <= 0) return;

        const drawX = this.x;
        const drawY = this.y;

        // Active Indicator (Triangle)
        if (isActive) {
            ctx.fillStyle = 'yellow';
            ctx.beginPath();
            ctx.moveTo(drawX, drawY - 70);
            ctx.lineTo(drawX - 10, drawY - 85);
            ctx.lineTo(drawX + 10, drawY - 85);
            ctx.fill();

            // Power Bar (Visual) - Moved below feet
            const barY = drawY + 45;
            ctx.fillStyle = 'white';
            ctx.fillRect(drawX - 25, barY, 50, 6);
            ctx.fillStyle = `hsl(${this.power}, 100%, 50%)`; // Color based on power
            ctx.fillRect(drawX - 25, barY, 50 * (this.power / 100), 6);
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 1;
            ctx.strokeRect(drawX - 25, barY, 50, 6);

            // Control Hints
            if (!this.isCPU) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '10px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('← Angle →', drawX, drawY + 15);
                ctx.fillText('↑ Power ↓', drawX, drawY + 25);
            }
        }

        // Archer Visual (Stick figure)
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Body
        ctx.moveTo(drawX, drawY); // Feet
        ctx.lineTo(drawX, drawY - 20); // Waist
        ctx.lineTo(drawX, drawY - 35); // Neck
        // Head
        ctx.moveTo(drawX + 5, drawY - 40);
        ctx.arc(drawX, drawY - 40, 5, 0, Math.PI * 2);
        // Legs
        ctx.moveTo(drawX, drawY - 20);
        ctx.lineTo(drawX - 10, drawY);
        ctx.moveTo(drawX, drawY - 20);
        ctx.lineTo(drawX + 10, drawY);
        ctx.stroke();

        // 弓の描画 (Curve)
        const rad = (this.angle * Math.PI) / 180;
        const cx = this.x;
        const cy = this.y - 35; // Shoulder height (center of rotation)

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-rad);

        // 弓本体
        ctx.beginPath();
        ctx.strokeStyle = '#8B4513'; // SaddleBrown
        ctx.lineWidth = 3;
        // 弓なりの形 (x,y) = (0,0) is center
        ctx.moveTo(0, -15);
        ctx.quadraticCurveTo(10, 0, 0, 15);
        ctx.stroke();

        // 弦
        ctx.beginPath();
        ctx.strokeStyle = '#DDD';
        ctx.lineWidth = 1;
        ctx.moveTo(0, -15);
        ctx.lineTo(0, 15);
        ctx.stroke();

        // 矢 (Health Packの時は描画しない、または薬箱を描画？シンプルに矢を描画せず)
        if (this.currentWeapon !== 'HEALTH') {
            ctx.beginPath();
            if (this.currentWeapon === 'NORMAL') ctx.strokeStyle = 'white';
            else if (this.currentWeapon === 'FIRE') ctx.strokeStyle = 'red';
            else if (this.currentWeapon === 'BOMB') ctx.strokeStyle = 'black';
            ctx.lineWidth = 2;

            ctx.moveTo(-5, 0); // Nock
            ctx.lineTo(20, 0); // Tip

            // Arrow Head
            ctx.lineTo(15, -3);
            ctx.moveTo(20, 0);
            ctx.lineTo(15, 3);

            ctx.stroke();
        }

        ctx.restore();

        // Player Label (Only for Human Players)
        if (!this.isCPU) {
            ctx.fillStyle = 'white';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            let label = `Player ${this.id}`;

            // Add background for readability
            const textWidth = ctx.measureText(label).width;

            // "label to be a bit higher (below current player ▼)"
            // Triangle bottom is drawY - 70.
            // HP Bar top is drawY - 55.
            // Let's try drawY - 62.
            const labelY = drawY - 62;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(this.x - textWidth / 2 - 2, labelY - 10, textWidth + 4, 14);

            ctx.fillStyle = 'white';
            ctx.fillText(label, this.x, labelY);
        }

        // HP Bar
        ctx.fillStyle = 'red';
        ctx.fillRect(drawX - 15, drawY - 55, 30, 4);
        ctx.fillStyle = 'lime';
        ctx.fillRect(drawX - 15, drawY - 55, (30 * Math.max(0, this.hp)) / 100, 4);

        // Fuel Bar (Scale for display since max is variable but usually 10-20ish active)
        // Max fuel capacity is 100, let's scale it to width 30
        ctx.fillStyle = 'orange';
        ctx.fillRect(drawX - 15, drawY - 50, (30 * Math.min(100, this.fuel)) / 100, 2);
    }

    move(dir, terrain) {
        if (this.fuel > 0 && this.hp > 0 && this.isStable) {
            let nextX = this.x + dir * this.moveSpeed;
            this.x = nextX;
            this.fuel -= 1;

            if (CONFIG.screenLoop) {
                if (this.x < 0) this.x += CONFIG.canvasWidth;
                if (this.x >= CONFIG.canvasWidth) this.x -= CONFIG.canvasWidth;
            } else {
                if (this.x < 0) this.x = 0;
                if (this.x >= CONFIG.canvasWidth) this.x = CONFIG.canvasWidth - 1;
            }
        }
    }

    takeDamage(amount) {
        this.hp -= amount;
        if (this.hp < 0) this.hp = 0;
    }
}

// ---------------------------------------------------------
// システム関数
// ---------------------------------------------------------

function init() {
    canvas.width = CONFIG.canvasWidth;
    canvas.height = CONFIG.canvasHeight;

    window.addEventListener('keydown', (e) => {
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyF', 'KeyB', 'KeyQ', 'KeyO', 'KeyP', 'Digit1', 'Digit2', 'Digit3'].indexOf(e.code) > -1) {
            e.preventDefault();
        }
        input.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
        input.keys[e.code] = false;
    });

    // Mobile / Touch Controls
    let lastTouch = null;
    window.addEventListener('touchstart', (e) => {
        if (e.target.tagName !== 'BUTTON') {
            lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (lastTouch && currentState === GameState.GAME_LOOP && isTurnActive) {
            e.preventDefault(); // Prevent scrolling
            const touch = e.touches[0];
            const dx = touch.clientX - lastTouch.x;
            const dy = touch.clientY - lastTouch.y;

            const p = players[currentPlayerIndex];
            if (p && !p.isCPU && p.hp > 0) {
                // Adjust Angle (Horizontal drag) - inverted for "pull" feel? Or direct?
                // Let's go direct: Right drag -> Angle decreases (aim right?), Left drag -> Angle increases (aim left)
                // Actually BowMan angle: 0 is Right, 180 is Left.
                // So dragging Right (positive dx) should decrease angle (towards 0).
                p.angle -= dx * 0.5;
                p.angle = Math.max(0, Math.min(180, p.angle));

                // Adjust Power (Vertical drag)
                // Drag Down (positive dy) -> Decrease power? Or Drag Up -> Increase?
                // Let's say Drag Up (negative dy) increases power.
                p.power -= dy * 0.5;
                p.power = Math.max(0, Math.min(100, p.power));
            }
            lastTouch = { x: touch.clientX, y: touch.clientY };
        }
    }, { passive: false });

    window.addEventListener('touchend', () => {
        lastTouch = null;
    });

    // Expose for HTML buttons
    window.mobileInput = function (action, state) {
        if (currentState !== GameState.GAME_LOOP) {
            // Title Screen Mapping
            if (action === 'Fire' && currentState === GameState.TITLE) {
                // Start Game
                input.keys['Space'] = true; // Trigger start
                setTimeout(() => input.keys['Space'] = false, 100);
            }
            if (action === 'Fire' && (currentState === GameState.RESULT || currentState === GameState.SHOP)) {
                input.keys['Space'] = true;
                setTimeout(() => input.keys['Space'] = false, 100);
            }
            // Title Settings (using Move buttons)
            if (currentState === GameState.TITLE) {
                if (action === 'Left') { input.keys['ArrowLeft'] = state; }
                if (action === 'Right') { input.keys['ArrowRight'] = state; }
            }
            // Shop Navigation
            if (currentState === GameState.SHOP) {
                if (action === 'Left') { input.keys['ArrowLeft'] = state; }
                if (action === 'Right') { input.keys['ArrowRight'] = state; }
                // Weapon button to buy? Maybe just use numbers on screen or map Weapon button to Buy 1?
                // For now, Shop on mobile might be tricky without numbers.
                // Let's verify shop logic later.
            }
            return;
        }

        // Game Loop Mapping
        if (action === 'Left') input.keys['KeyA'] = state;
        if (action === 'Right') input.keys['KeyD'] = state;

        if (action === 'Fire') {
            // Toggle Space
            // For buttons, we might want 'onclick' (pulse) or press/release.
            // The HTML uses onclick for Fire/Weapon, start/end for Move.
            // If onclick, pulse it.
            input.keys['Space'] = true;
            setTimeout(() => input.keys['Space'] = false, 100);
        }

        if (action === 'Weapon') {
            input.keys['KeyW'] = true;
            setTimeout(() => input.keys['KeyW'] = false, 100);
        }
    };

    // タイトルへ
    currentState = GameState.TITLE;

    requestAnimationFrame(gameLoop);
}

function initGame() {
    terrain = new Terrain(CONFIG.canvasWidth, CONFIG.canvasHeight);
    players = [];
    projectiles = [];
    particles = [];
    fires = [];

    // 風はステージごとに固定
    wind = (Math.random() * 0.2) - 0.1;

    randomizeBackground();

    // プレイヤー生成（人間 + CPU）
    const totalPlayers = settingHumans + settingCPUs;
    const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan', 'magenta', 'orange', 'lime', 'pink'];

    // Generate players first
    for (let i = 0; i < totalPlayers; i++) {
        const isCPU = i >= settingHumans;
        const color = colors[i % colors.length];
        // Temporary X, will be set after shuffle
        const p = new Player(i + 1, color, 0, isCPU);
        players.push(p);
    }

    // Shuffle players for random turn order
    for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
    }

    // Assign positions based on shuffled order (Left -> Right = Turn 1 -> N)
    players.forEach((p, index) => {
        p.x = (CONFIG.canvasWidth / (players.length + 1)) * (index + 1);
        p.angle = (p.x < CONFIG.canvasWidth / 2) ? 45 : 135;
        // If CPU, randomize angle slightly
        if (p.isCPU) {
            p.angle = Math.floor(Math.random() * 180);
        }
    });

    currentPlayerIndex = 0;
    isTurnActive = true;
    cpuThinking = false;
    hasActionTaken = false;
    if (cpuTurnTimeout) clearTimeout(cpuTurnTimeout);
    cpuTurnTimeout = null;

    console.log("--- Game Init ---");
    players.forEach(p => console.log(`Player ${p.id}: HP=${p.hp}, X=${p.x}, Y=${p.y}, CPU=${p.isCPU}`));
}

function randomizeBackground() {
    const hours = ['MORNING', 'DAY', 'EVENING', 'NIGHT'];
    const type = hours[Math.floor(Math.random() * hours.length)];

    switch (type) {
        case 'MORNING':
            bgGradient = { top: '#87CEEB', bottom: '#E0F7FA' };
            break;
        case 'DAY':
            bgGradient = { top: '#1E90FF', bottom: '#87CEEB' };
            break;
        case 'EVENING':
            bgGradient = { top: '#4B0082', bottom: '#FF4500' };
            break;
        case 'NIGHT':
            bgGradient = { top: '#000033', bottom: '#4B0082' };
            break;
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    switch (currentState) {
        case GameState.TITLE:
            updateTitle();
            drawTitle();
            break;
        case GameState.GAME_LOOP:
            updateGame();
            drawGame();
            break;
        case GameState.SHOP:
            updateShop();
            drawShop();
            break;
        case GameState.RESULT:
            updateResult();
            drawResult();
            break;
    }

    updateInput();
    requestAnimationFrame(gameLoop);
}

function updateInput() {
    input.prevKeys = { ...input.keys };
}

function isKeyPressed(code) {
    return input.keys[code] && !input.prevKeys[code];
}

function isKeyDown(code) {
    return input.keys[code];
}

// ---------------------------------------------------------
// ゲーム進行管理
// ---------------------------------------------------------

function nextTurn() {
    console.log(`nextTurn START. Current: ${currentPlayerIndex}, HP=${players[currentPlayerIndex]?.hp}. Active=${isTurnActive}`);

    // Clear any pending CPU action
    if (cpuTurnTimeout) {
        clearTimeout(cpuTurnTimeout);
        cpuTurnTimeout = null;
    }

    // If nextTurn is somehow called while turn is already active (rare race condition?), ignoring might be safer,
    // but usually we want to force next turn.
    // However, resetting flags is key.


    // ターン終了時の炎ダメージ判定
    const currentP = players[currentPlayerIndex];
    if (currentP.hp > 0) {
        const inFire = fires.some(f =>
            Math.abs(f.x - currentP.x) < currentP.width &&
            Math.abs(f.y - (currentP.y - currentP.height / 2)) < currentP.height
        );
        if (inFire) {
            currentP.takeDamage(15); // 炎上ダメージ
        }
    }

    const alivePlayers = players.filter(p => p.hp > 0);
    if (alivePlayers.length <= 1) {
        if (alivePlayers.length === 1) {
            // Winner gets Rank 1 Reward
            console.log(`Player ${alivePlayers[0].id} WINS! Reward: $1000`);
            alivePlayers[0].money += 1000;
        }

        // ショップ移行前の処理
        // CPUの買い物ロジックを実行してからショップへ
        players.filter(p => p.isCPU).forEach(cpu => cpuShopLogic(cpu));

        // Sort players by ID for Shop Display (Player 1 -> Player 2...)
        players.sort((a, b) => a.id - b.id);

        shopCursor = 0; // ショップのリセット
        currentState = GameState.SHOP;
        return;
    }

    do {
        currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
        console.log(`  Checking Index ${currentPlayerIndex}: HP=${players[currentPlayerIndex].hp}, CPU=${players[currentPlayerIndex].isCPU}`);
    } while (players[currentPlayerIndex].hp <= 0);

    console.log(`nextTurn END. Next Player: ${currentPlayerIndex}`);

    // 燃料蓄積 (Max 100)
    players[currentPlayerIndex].fuel = Math.min(100, players[currentPlayerIndex].fuel + 10);

    isTurnActive = true;
    cpuThinking = false;
    hasActionTaken = false;
}

// ---------------------------------------------------------
// TITLE
// ---------------------------------------------------------

function updateTitle() {
    // 設定変更
    if (isKeyPressed('ArrowRight')) settingHumans = Math.min(10, settingHumans + 1); // Max 10 人間
    if (isKeyPressed('ArrowLeft')) settingHumans = Math.max(0, settingHumans - 1);
    if (isKeyPressed('ArrowUp')) settingCPUs = Math.min(10, settingCPUs + 1); // Max 10 CPU
    if (isKeyPressed('ArrowDown')) settingCPUs = Math.max(0, settingCPUs - 1);

    // 合計上限チェック
    if (settingHumans + settingCPUs > 10) {
        // 増やした方を戻すのは難しいので、設定時にキャップする
    }

    // 最低2人は必要
    if (settingHumans + settingCPUs < 1) settingHumans = 1;

    if (isKeyPressed('Space')) {
        currentState = GameState.GAME_LOOP;
        initGame();
    }
}

function drawTitle() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 画像表示
    if (titleImage.complete) {
        const imgWidth = 600;
        const imgHeight = 200;
        ctx.drawImage(titleImage, (canvas.width - imgWidth) / 2, 50, imgWidth, imgHeight);
    } else {
        ctx.fillStyle = 'white';
        ctx.font = '60px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('BOW MAN', canvas.width / 2, canvas.height / 2 - 100);
    }

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.font = '20px monospace';
    ctx.fillText('SETTINGS', canvas.width / 2, canvas.height / 2 + 50);
    ctx.fillText(`Humans: ${settingHumans} (Left/Right)`, canvas.width / 2, canvas.height / 2 + 80);
    ctx.fillText(`CPUs:   ${settingCPUs} (Up/Down)`, canvas.width / 2, canvas.height / 2 + 110);

    ctx.fillStyle = 'yellow';
    ctx.fillText('Press SPACE to Start', canvas.width / 2, canvas.height / 2 + 180);
}

// ---------------------------------------------------------
// GAME LOOP
// ---------------------------------------------------------

function updateGame() {
    // 物理・エフェクト更新
    projectiles.forEach(p => p.update());
    projectiles = projectiles.filter(p => p.isActive);

    particles.forEach(p => p.update());
    particles = particles.filter(p => p.isActive);

    players.forEach(player => player.update(terrain));
    fires.forEach(f => f.update(terrain));
    // fires = fires.filter(f => f.life > 0); // 永続化のため削除

    const p = players[currentPlayerIndex];

    // プレイヤー行動
    // 落下中（!isStable）は行動不能にする
    if (isTurnActive && projectiles.length === 0 && p.hp > 0 && p.isStable) {
        if (p.isCPU) {
            // CPU AI
            if (!cpuThinking) {
                cpuThinking = true;
                // 少し移動する
                if (cpuTurnTimeout) clearTimeout(cpuTurnTimeout);
                cpuTurnTimeout = setTimeout(() => {
                    // Check if It is still my turn!
                    if (players[currentPlayerIndex] === p && isTurnActive) {
                        executeCpuTurn(p);
                        // 発射後はfireProjectileでisTurnActive=falseになる
                    } else {
                        console.log("CPU Turn Skipped: Timeout fired but turn changed or inactive.");
                    }
                    cpuThinking = false;
                }, 1000 + Math.random() * 1000);
            }
        } else {
            // 人間操作
            if (isKeyDown('KeyA')) p.move(-1, terrain);
            if (isKeyDown('KeyD')) p.move(1, terrain);
            if (isKeyDown('ArrowLeft')) p.angle = Math.min(180, p.angle + 1);
            if (isKeyDown('ArrowRight')) p.angle = Math.max(0, p.angle - 1);
            if (isKeyDown('ArrowUp')) p.power = Math.min(100, p.power + 1);
            if (isKeyDown('ArrowDown')) p.power = Math.max(0, p.power - 1);

            if (isKeyPressed('KeyW') || isKeyPressed('KeyS')) {
                const types = ['NORMAL', 'FIRE', 'BOMB', 'TRIPLE', 'LASER', 'HEALTH'];
                let idx = types.indexOf(p.currentWeapon);
                if (isKeyPressed('KeyW')) idx = (idx + 1) % types.length;
                if (isKeyPressed('KeyS')) idx = (idx - 1 + types.length) % types.length;
                p.currentWeapon = types[idx];
            }

            if (isKeyPressed('Space')) {
                if (p.currentWeapon === 'HEALTH') {
                    // 回復アイテム使用
                    if (p.inventory['HEALTH'] > 0) {
                        useHealthItem(p);
                        isTurnActive = false;
                        hasActionTaken = true; // Action confirmed
                        setTimeout(() => {
                            nextTurn();
                        }, 1000);
                    }
                } else {
                    Sound.shoot(); // 発射音
                    fireProjectile(p);
                    isTurnActive = false;
                    hasActionTaken = true; // Action confirmed
                }
            }
        }
    }

    // Check for falling death (Player fell into pit)
    if (p.hp <= 0 && isTurnActive) {
        console.log(`Player ${p.id} Died (Falling/HP0). Y=${p.y}`);
        isTurnActive = false;
        hasActionTaken = true; // Treat death as action

        // --- Ranked Money Reward ---
        // Rank = (Survivors + 1)
        // Survivors excluding self (who just died)
        const survivors = players.filter(pl => pl.hp > 0 && pl !== p).length;
        const rank = survivors + 1;
        let reward = 100;
        if (rank === 2) reward = 500;
        else if (rank === 3) reward = 300;
        else if (rank === 4) reward = 200;

        console.log(`Player ${p.id} finished Rank ${rank}. Reward: $${reward}`);
        p.money += reward;
        // ---------------------------

        setTimeout(() => {
            nextTurn();
        }, 1000);
    }

    // Turn transition when projectiles are gone
    if (hasActionTaken && !isTurnActive && projectiles.length === 0 && currentState === GameState.GAME_LOOP) {
        // Debounce or wait a moment?
        // Check if we are already waiting for nextTurn? 
        // We need a flag to prevent multiple nextTurn calls if we rely on update loop
        // But simply checking projectiles.length === 0 is usually safe if we set hasActionTaken=false in nextTurn immediately.
        // Let's add a small valid wait.

        // However, we need to avoid calling it repeatedly every frame while waiting for the timeout.
        // Simplified: Just call nextTurn if not already processing. 
        // But we don't have 'isProcessingTurnEnd' anymore (user reverted).
        // Let's rely on a property or reusable flag.
        // Actually, let's add `isProcessingTurnEnd` back locally or logic.

        // Optimization: Create a one-off transition
        if (!p.isProcessingTurnEnd) {
            p.isProcessingTurnEnd = true;
            setTimeout(() => {
                p.isProcessingTurnEnd = false; // Reset for next time (though p might change)
                nextTurn();
            }, 500);
        }
    }
}

function useHealthItem(player) {
    if (player.inventory['HEALTH'] > 0) {
        player.inventory['HEALTH']--;
        player.hp = Math.min(100, player.hp + 50);
        Sound.heal();
        // エフェクト（簡易）
        particles.push(new Explosion(player.x, player.y - 20, 20));
    }
}

function isLocationSafe(x, y, width, height) {
    // 炎判定
    return !fires.some(f =>
        Math.abs(f.x - x) < width + 10 &&
        Math.abs(f.y - (y - height / 2)) < height
    );
}

function executeCpuTurn(cpu) {
    console.log("executeCpuTurn start for:", cpu.id);
    // 0. 回避行動 & 移動フェーズ
    let moveDir = Math.random() > 0.5 ? 1 : -1;
    let moveAmount = 0;

    // 現在地の安全性チェック
    const currentY = terrain.getHeight(cpu.x);
    const isCurrentSafe = isLocationSafe(cpu.x, currentY, cpu.width, cpu.height);

    if (!isCurrentSafe) {
        // 現在地が炎上中 -> 安全圏へ脱出
        moveAmount = 20 + Math.floor(Math.random() * 20);
    } else if (cpu.hp < cpu.prevHp) {
        // 被弾後 -> 回避行動
        moveAmount = 15 + Math.floor(Math.random() * 30);
    } else {
        // 通常 -> 微調整
        moveAmount = Math.floor(Math.random() * 5);
    }

    // 移動先が安全かチェック
    const totalDist = moveAmount * cpu.moveSpeed;

    // 左右どちらか、あるいは両方を検討
    const dirs = [1, -1];
    if (Math.random() > 0.5) dirs.reverse(); // ランダム順

    let bestDir = 0;

    for (let d of dirs) {
        let tx = cpu.x + d * totalDist;
        if (CONFIG.screenLoop) {
            if (tx < 0) tx += CONFIG.canvasWidth;
            if (tx >= CONFIG.canvasWidth) tx -= CONFIG.canvasWidth;
        } else {
            if (tx < 0) tx = 0;
            if (tx >= CONFIG.canvasWidth) tx = CONFIG.canvasWidth - 1;
        }
        const ty = terrain.getHeight(tx);

        if (isLocationSafe(tx, ty, cpu.width, cpu.height)) {
            bestDir = d;
            break; // 安全な方向発見
        }
    }

    if (bestDir !== 0) {
        moveDir = bestDir;
    } else {
        // 安全な移動先がない場合
        if (isCurrentSafe) {
            // 今安全なら動かない方がマシ
            moveAmount = 0;
        }
    }

    // 移動実行
    for (let i = 0; i < moveAmount; i++) {
        cpu.move(moveDir, terrain);
        // 燃料尽きたら終了
        if (cpu.fuel <= 0) break;
    }

    // HP状態更新
    cpu.prevHp = cpu.hp;

    // HP回復優先
    // HP回復優先
    if (cpu.hp < 50 && cpu.inventory['HEALTH'] > 0) {
        cpu.currentWeapon = 'HEALTH';
        useHealthItem(cpu);
        isTurnActive = false;
        hasActionTaken = true; // Use common transition logic
        return;
    }

    // 1. ターゲット選択
    const enemies = players.filter(p => p.id !== cpu.id && p.hp > 0);
    if (enemies.length === 0) {
        Sound.shoot();
        fireProjectile(cpu);
        isTurnActive = false;
        hasActionTaken = true;
        return;
    }

    // ターゲット決定
    const target = enemies[Math.floor(Math.random() * enemies.length)];

    // 2. 武器選択
    if (cpu.inventory['BOMB'] > 0) cpu.currentWeapon = 'BOMB';
    else if (cpu.inventory['TRIPLE'] > 0) cpu.currentWeapon = 'TRIPLE';
    else if (cpu.inventory['FIRE'] > 0) cpu.currentWeapon = 'FIRE';
    else cpu.currentWeapon = 'NORMAL';

    // 3. 狙う
    let dist = target.x - cpu.x;
    if (CONFIG.screenLoop) {
        // ループ考慮
        if (Math.abs(dist) > CONFIG.canvasWidth / 2) {
            dist = dist > 0 ? dist - CONFIG.canvasWidth : dist + CONFIG.canvasWidth;
        }
    }

    // シンプルに「ターゲットの方向」を向く + ランダム誤差
    if (dist > 0) cpu.angle = 20 + Math.random() * 40; // 右
    else cpu.angle = 120 + Math.random() * 40; // 左

    // 距離に応じたパワー
    let targetPower = Math.abs(dist) / 11 + Math.random() * 10;
    cpu.power = Math.min(100, Math.max(10, targetPower));

    // 実行
    Sound.shoot();
    fireProjectile(cpu);
    isTurnActive = false;
    hasActionTaken = true;
}

function fireProjectile(player) {
    if (player.currentWeapon !== 'NORMAL') {
        if (player.inventory[player.currentWeapon] > 0) {
            player.inventory[player.currentWeapon]--;
        } else {
            player.currentWeapon = 'NORMAL';
        }
    }

    const rad = (player.angle * Math.PI) / 180;
    const speed = player.power * 0.3;
    let vx = Math.cos(-rad) * speed;
    let vy = Math.sin(-rad) * speed;

    // Laser is faster
    if (player.currentWeapon === 'LASER') {
        const laserSpeed = speed * 3.0; // Much faster
        vx = Math.cos(-rad) * laserSpeed;
        vy = Math.sin(-rad) * laserSpeed;
    }

    const x = player.x + Math.cos(-rad) * 20;
    const y = (player.y - 35) + Math.sin(-rad) * 20; // 発射位置調整

    if (player.currentWeapon === 'TRIPLE') {
        const angles = [-5, 0, 5];
        angles.forEach(offset => {
            const aRad = ((player.angle + offset) * Math.PI) / 180;
            const avx = Math.cos(-aRad) * speed;
            const avy = Math.sin(-aRad) * speed;
            // Mark as 'NORMAL' to ensure standard behavior, avoiding 'TRIPLE' logic in update/draw if it causes issues.
            // Or keep 'TRIPLE' if draw logic needs it, but ensure update logic handles it safely.
            // Previous fix used NORMAL. Let's use NORMAL to be safe.
            projectiles.push(new Projectile(x, y, avx, avy, player.id, 'NORMAL'));
        });
    } else {
        projectiles.push(new Projectile(x, y, vx, vy, player.id, player.currentWeapon));
    }

    // マズルフラッシュ
    particles.push(new Explosion(x, y, 10));
}

function drawGame() {
    if (!bgGradient) randomizeBackground();
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, bgGradient.top);
    grad.addColorStop(1, bgGradient.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (bgGradient.top === '#000033') {
        ctx.fillStyle = 'white';
        for (let i = 0; i < 30; i++) {
            ctx.fillRect((i * 137) % canvas.width, (i * 53) % 300, 2, 2);
        }
    }

    if (terrain) terrain.draw(ctx);
    players.forEach((player, idx) => player.draw(ctx, idx === currentPlayerIndex));
    fires.forEach(f => f.draw(ctx));
    projectiles.forEach(p => p.draw(ctx));
    particles.forEach(p => p.draw(ctx));

    // 画面外インジケータ
    projectiles.forEach(p => {
        if (p.y < 0 && p.isActive) {
            ctx.fillStyle = 'yellow';
            ctx.beginPath();
            ctx.moveTo(p.x, 10);
            ctx.lineTo(p.x - 5, 20);
            ctx.lineTo(p.x + 5, 20);
            ctx.fill();
        }
    });

    drawHUD();
}

function drawHUD() {
    const p = players[currentPlayerIndex];
    ctx.fillStyle = 'white';
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 2;

    const turnStr = p.isCPU ? `Player ${p.id} (CPU) Turn` : `Player ${p.id} Turn`;
    ctx.fillText(turnStr, 10, 20);
    ctx.fillText(`Angle: ${Math.floor(p.angle)}`, 10, 40);
    ctx.fillText(`Power: ${Math.floor(p.power)}`, 10, 60);
    ctx.fillText(`Fuel: ${p.fuel}`, 10, 80);
    ctx.fillText(`HP: ${p.hp}`, 10, 100);
    ctx.fillText(`Money: $${p.money}`, 10, 120);

    let weaponText = `Weapon: ${p.currentWeapon}`;
    if (p.currentWeapon !== 'NORMAL') {
        weaponText += ` (${p.inventory[p.currentWeapon]})`;
    }
    ctx.fillText(weaponText, 10, 140);

    ctx.shadowBlur = 0;

    // Wind Display Update
    ctx.textAlign = 'center';
    ctx.fillText(`Wind`, canvas.width / 2, 20);

    // 矢印描画
    const cx = canvas.width / 2;
    const cy = 40;
    const windScale = 300; // 長さ係数
    const windLen = wind * windScale;
    const thickness = Math.abs(wind) * 20 + 1; // 太さ係数

    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    ctx.lineWidth = thickness;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + windLen, cy);
    ctx.stroke();

    // 矢印先端
    ctx.beginPath();
    if (wind > 0) {
        ctx.moveTo(cx + windLen, cy);
        ctx.lineTo(cx + windLen - 5, cy - 5);
        ctx.lineTo(cx + windLen - 5, cy + 5);
    } else {
        ctx.moveTo(cx + windLen, cy);
        ctx.lineTo(cx + windLen + 5, cy - 5);
        ctx.lineTo(cx + windLen + 5, cy + 5);
    }
    ctx.fill();

    // 操作ヘルプ（人間の場合のみ）
    if (!p.isCPU) {
        ctx.textAlign = 'right';
        ctx.fillText('Arrows: Aim/Power | A/D: Move | W/S: Weapon', canvas.width - 10, 20);
        ctx.fillText('SPACE: Fire/Use', canvas.width - 10, 40);
    }
}

// ---------------------------
// ショップ (Overhauled)
// ---------------------------

function cpuShopLogic(cpu) {
    const budget = cpu.money;
    let attempts = 0;
    while (cpu.money >= 150 && attempts < 10) { // Keep buying while affordable (min price 150)
        let purchased = false;

        // Priority 1: Health if low
        if (cpu.hp < 50 && cpu.money >= ITEMS.HEALTH.price && (cpu.inventory.HEALTH || 0) < 2) {
            buyItem(cpu, 'HEALTH');
            purchased = true;
        }
        // Priority 2: High power weapons
        else if (cpu.money >= ITEMS.LASER.price && (cpu.inventory.LASER || 0) < 3) {
            buyItem(cpu, 'LASER');
            purchased = true;
        }
        else if (cpu.money >= ITEMS.TRIPLE.price && (cpu.inventory.TRIPLE || 0) < 3) {
            buyItem(cpu, 'TRIPLE');
            purchased = true;
        }
        else if (cpu.money >= ITEMS.BOMB.price && (cpu.inventory.BOMB || 0) < 3) {
            buyItem(cpu, 'BOMB');
            purchased = true;
        }
        else if (cpu.money >= ITEMS.FIRE.price && (cpu.inventory.FIRE || 0) < 5) {
            buyItem(cpu, 'FIRE');
            purchased = true;
        }

        if (!purchased) break; // Couldn't afford or need anything
        attempts++;
    }
}

function updateShop() {
    // プレイヤー選択
    if (isKeyPressed('ArrowRight')) {
        shopCursor = (shopCursor + 1) % players.length;
    }
    if (isKeyPressed('ArrowLeft')) {
        shopCursor = (shopCursor - 1 + players.length) % players.length;
    }

    // アイテム購入 (1/2/3キー or Q/W/E)
    const targetPlayer = players[shopCursor];
    if (targetPlayer && !targetPlayer.isCPU) {
        if (isKeyPressed('Digit1') || isKeyPressed('KeyQ')) buyItem(targetPlayer, 'FIRE');
        if (isKeyPressed('Digit2') || isKeyPressed('KeyW')) buyItem(targetPlayer, 'BOMB');
        if (isKeyPressed('Digit3') || isKeyPressed('KeyE')) buyItem(targetPlayer, 'HEALTH');
        if (isKeyPressed('Digit4') || isKeyPressed('KeyR')) buyItem(targetPlayer, 'TRIPLE');
        if (isKeyPressed('Digit5') || isKeyPressed('KeyT')) buyItem(targetPlayer, 'LASER');
    }

    if (isKeyPressed('Space')) {
        startNextRound();
    }
}

function buyItem(player, type) {
    if (!player) return;
    const item = ITEMS[type];
    if (player.money >= item.price) {
        player.money -= item.price;
        // HEALTH also goes to inventory now, not instant use
        player.inventory[type] = (player.inventory[type] || 0) + 1;
    }
}

function startNextRound() {
    terrain = new Terrain(CONFIG.canvasWidth, CONFIG.canvasHeight);
    randomizeBackground();

    // Reset loop
    // Shuffle players for random turn order
    for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
    }

    players.forEach((p, index) => {
        p.hp = 100;
        p.prevHp = 100;
        // Assign X based on new shuffled order -> Left to Right is Turn 1 -> N
        p.x = (CONFIG.canvasWidth / (players.length + 1)) * (index + 1);
        p.y = 0;
        p.angle = (p.x < CONFIG.canvasWidth / 2) ? 45 : 135;
        p.isStable = true;
        p.isDead = false;
        // 燃料もリセットでいいか？蓄積はターン毎。次ラウンドはリセットでOK
        p.fuel = 10;
    });

    fires = []; // ステージ変更時に炎を消去

    currentPlayerIndex = 0;
    isTurnActive = true;
    cpuThinking = false;

    currentState = GameState.GAME_LOOP;
}

function drawShop() {
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';

    ctx.font = '30px monospace';
    ctx.fillText('SHOP', canvas.width / 2, 40);

    ctx.font = '20px monospace';
    ctx.fillText('< Select Player >', canvas.width / 2, 80);

    // 選択中のプレイヤー情報
    const p = players[shopCursor];
    if (p) {
        ctx.fillStyle = p.color;
        ctx.font = '24px monospace';
        let name = `Player ${p.id}`;
        if (p.isCPU) name += " (CPU)";
        ctx.fillText(name, canvas.width / 2, 120);

        ctx.fillStyle = 'white';
        ctx.font = '20px monospace';
        ctx.fillText(`Money: $${p.money} | HP: ${p.hp}`, canvas.width / 2, 150);
        // Inventory line removed, displayed in menu

        // メニュー
        if (!p.isCPU) {
            const startY = 250;
            ctx.textAlign = 'left';
            ctx.fillText(`[1] Buy Fire Arrow   ($150) [Owned: ${p.inventory.FIRE}]`, 200, startY);
            ctx.fillText(`[2] Buy Bomb Arrow   ($300) [Owned: ${p.inventory.BOMB}]`, 200, startY + 40);
            ctx.fillText(`[3] Buy Health Pack  ($200) [Owned: ${p.inventory.HEALTH}]`, 200, startY + 80);
            ctx.fillText(`[4] Buy Triple Arrow ($250) [Owned: ${p.inventory.TRIPLE}]`, 200, startY + 120);
            ctx.fillText(`[5] Buy Laser Arrow  ($400) [Owned: ${p.inventory.LASER}]`, 200, startY + 160);
        } else {
            ctx.fillStyle = 'gray';
            ctx.fillText("(CPU Buys Automatically)", canvas.width / 2, 250);
        }
    }

    ctx.fillStyle = 'yellow';
    ctx.textAlign = 'center';
    ctx.fillText('Press SPACE to Start Next Round', canvas.width / 2, canvas.height - 50);
}

function updateResult() {
    if (isKeyPressed('Space')) {
        currentState = GameState.SHOP;
    }
}

function drawResult() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.font = '40px monospace';
    ctx.textAlign = 'center';

    const winner = players.find(p => p.hp > 0);
    const msg = winner ? `Player ${winner.id} WINS!` : "GAME OVER";

    ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
    ctx.font = '20px monospace';
    ctx.fillText('Press SPACE to Go to Shop', canvas.width / 2, canvas.height / 2 + 50);
}

// ゲーム開始
init();
