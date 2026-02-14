// キャンバスとコンテキストの取得
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ゲーム設定
const CONFIG = {
    canvasWidth: 800,
    canvasHeight: 600,
    gravity: 0.1, // 重力
    windChange: 0.005,
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
    'HEALTH': { name: 'Health Pack', price: 200, type: 'HEALTH' }
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

// タイトル画面用設定
let settingHumans = 1;
let settingCPUs = 1;

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

        fires = fires.filter(f => {
            const dx = Math.abs(f.x - cx);
            const distX = CONFIG.screenLoop ? Math.min(dx, CONFIG.canvasWidth - dx) : dx;
            const distY = Math.abs(f.y - cy);
            return Math.sqrt(distX * distX + distY * distY) > radius;
        });
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
 * 炎クラス
 */
class Fire {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.life = 200;
        this.frame = 0;
    }

    update(terrain) {
        this.life--;
        this.frame++;

        const groundY = terrain.getHeight(this.x);
        this.y = groundY;

        players.forEach(p => {
            if (p.hp > 0 &&
                Math.abs(this.x - p.x) < p.width &&
                Math.abs(this.y - (p.y - p.height / 2)) < p.height) {
                if (this.frame % 10 === 0) {
                    p.takeDamage(1);
                }
            }
        });
    }

    draw(ctx) {
        ctx.fillStyle = `rgba(255, ${Math.random() * 100 + 50}, 0, ${this.life / 200})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y - 5, 5 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
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
    }

    update() {
        this.vy += CONFIG.gravity;
        this.vx += wind;
        this.x += this.vx;
        this.y += this.vy;

        if (CONFIG.screenLoop) {
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

                this.explode(this.x, this.y);
                break;
            }
        }
    }

    explode(x, y) {
        this.isActive = false;

        particles.push(new Explosion(x, y, 30));

        let explosionRadius = 20; // 通常は小さく（調整：30 -> 20）
        let damageMultiplier = 1.0;

        if (this.type === 'BOMB') {
            explosionRadius = 80; // 爆矢は広く（調整：60 -> 80）
            damageMultiplier = 1.5;
            particles.push(new Explosion(x, y, 60));
        } else if (this.type === 'FIRE') {
            explosionRadius = 15;
            for (let i = 0; i < 5; i++) {
                fires.push(new Fire(x + (Math.random() * 20 - 10), y));
            }
        } else {
            // NORMAL
            explosionRadius = 10; // さらに小さく
        }

        terrain.destroy(x, y, explosionRadius);

        players.forEach(p => {
            const dx = Math.abs(x - p.x);
            const distX = CONFIG.screenLoop ? Math.min(dx, CONFIG.canvasWidth - dx) : dx;
            const distY = Math.abs(y - (p.y - p.height / 2));
            const dist = Math.sqrt(distX * distX + distY * distY);

            // ダメージ判定半径は少し広めに
            if (dist < explosionRadius * 2.0 + 20) {
                let damage = 0;
                // 中心に近いほど大ダメージ
                const damageRadius = explosionRadius * 2.0 + 20;
                damage = Math.floor(50 * damageMultiplier * (1 - dist / damageRadius));

                if (damage > 0) {
                    p.takeDamage(damage);
                }
            }
        });

        setTimeout(() => nextTurn(), 1000);
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);

        if (this.type === 'NORMAL') ctx.fillStyle = 'white';
        else if (this.type === 'FIRE') ctx.fillStyle = 'red';
        else if (this.type === 'BOMB') ctx.fillStyle = 'black';

        ctx.fill();
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.stroke();
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
        this.y = 0;
        this.width = 20;
        this.height = 30;
        this.hp = 100;
        this.angle = isCPU ? Math.floor(Math.random() * 180) : 45;
        this.power = isCPU ? 30 + Math.floor(Math.random() * 50) : 50;
        this.moveSpeed = 2;
        this.fuel = 100;
        this.money = 0;
        this.isCPU = isCPU;

        this.inventory = {
            'FIRE': 0,
            'BOMB': 0
        };
        this.currentWeapon = 'NORMAL';
    }

    update(terrain) {
        const groundY = terrain.getHeight(this.x);

        if (this.y < groundY) {
            this.y += 2;
            if (this.y > groundY) this.y = groundY;
        } else {
            this.y = groundY;
        }

        if (this.y >= CONFIG.canvasHeight - 10) {
            this.hp = 0;
        }
    }

    draw(ctx) {
        if (this.hp <= 0) return;

        const drawX = this.x - this.width / 2;
        const drawY = this.y - this.height;

        ctx.fillStyle = this.color;
        ctx.fillRect(drawX, drawY, this.width, this.height);

        // CPU表示
        if (this.isCPU) {
            ctx.fillStyle = 'white';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('CPU', this.x, drawY - 25);
        }

        const rad = (this.angle * Math.PI) / 180;
        const cx = this.x;
        const cy = this.y - (this.height * 0.7);
        const barrelLen = 30;

        const aimX = cx + Math.cos(-rad) * barrelLen;
        const aimY = cy + Math.sin(-rad) * barrelLen;

        ctx.beginPath();
        if (this.currentWeapon === 'NORMAL') ctx.strokeStyle = 'white';
        else if (this.currentWeapon === 'FIRE') ctx.strokeStyle = 'red';
        else if (this.currentWeapon === 'BOMB') ctx.strokeStyle = 'black';

        ctx.lineWidth = 3;
        ctx.moveTo(cx, cy);
        ctx.lineTo(aimX, aimY);
        ctx.stroke();

        ctx.fillStyle = 'orange';
        ctx.fillRect(drawX, drawY - 10, (this.width * this.fuel) / 100, 4);

        ctx.fillStyle = 'red';
        ctx.fillRect(drawX, drawY - 16, this.width, 4);
        ctx.fillStyle = 'lime';
        ctx.fillRect(drawX, drawY - 16, (this.width * Math.max(0, this.hp)) / 100, 4);
    }

    move(dir, terrain) {
        if (this.fuel > 0 && this.hp > 0) {
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
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyF', 'KeyB', 'KeyQ', 'KeyO', 'KeyP'].indexOf(e.code) > -1) {
            e.preventDefault();
        }
        input.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
        input.keys[e.code] = false;
    });

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
    wind = (Math.random() * 0.2) - 0.1;

    randomizeBackground();

    // プレイヤー生成（人間 + CPU）
    const totalPlayers = settingHumans + settingCPUs;
    const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'cyan', 'magenta', 'orange'];

    for (let i = 0; i < totalPlayers; i++) {
        const isCPU = i >= settingHumans;
        const color = colors[i % colors.length];
        const startX = (CONFIG.canvasWidth / (totalPlayers + 1)) * (i + 1);
        const p = new Player(i + 1, color, startX, isCPU);

        // 初期向き調整（画面左側は右向き、右側は左向き目安）
        p.angle = startX < CONFIG.canvasWidth / 2 ? 45 : 135;

        players.push(p);
    }

    currentPlayerIndex = 0;
    isTurnActive = true;
    cpuThinking = false;
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
    const alivePlayers = players.filter(p => p.hp > 0);
    if (alivePlayers.length <= 1) {
        if (alivePlayers.length === 1) {
            alivePlayers[0].money += 1000;
        }

        // ショップ移行前の処理
        // CPUの買い物ロジックを実行してからショップへ
        players.filter(p => p.isCPU).forEach(cpu => cpuShopLogic(cpu));

        currentState = GameState.SHOP;
        return;
    }

    do {
        currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    } while (players[currentPlayerIndex].hp <= 0);

    wind = (Math.random() * 0.2) - 0.1;
    players[currentPlayerIndex].fuel = 100;

    isTurnActive = true;
    cpuThinking = false;
}

// ---------------------------------------------------------
// TITLE
// ---------------------------------------------------------

function updateTitle() {
    // 設定変更
    if (isKeyPressed('ArrowRight')) settingHumans = Math.min(5, settingHumans + 1);
    if (isKeyPressed('ArrowLeft')) settingHumans = Math.max(0, settingHumans - 1);
    if (isKeyPressed('ArrowUp')) settingCPUs = Math.min(9, settingCPUs + 1);
    if (isKeyPressed('ArrowDown')) settingCPUs = Math.max(0, settingCPUs - 1);

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

    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';

    ctx.font = '60px monospace';
    ctx.fillText('BOW MAN', canvas.width / 2, canvas.height / 2 - 100);

    ctx.font = '20px monospace';
    ctx.fillText('SETTINGS', canvas.width / 2, canvas.height / 2 - 20);
    ctx.fillText(`Humans: ${settingHumans} (Left/Right)`, canvas.width / 2, canvas.height / 2 + 20);
    ctx.fillText(`CPUs:   ${settingCPUs} (Up/Down)`, canvas.width / 2, canvas.height / 2 + 50);

    ctx.fillStyle = 'yellow';
    ctx.fillText('Press SPACE to Start', canvas.width / 2, canvas.height / 2 + 120);
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

    fires.forEach(f => f.update(terrain));
    fires = fires.filter(f => f.life > 0);

    const p = players[currentPlayerIndex];

    // プレイヤー行動
    if (isTurnActive && projectiles.length === 0 && p.hp > 0) {
        if (p.isCPU) {
            // CPU AI
            if (!cpuThinking) {
                cpuThinking = true;
                // 少し考えてから発射
                setTimeout(() => {
                    executeCpuTurn(p);
                    // 発射後はfireProjectileでisTurnActive=falseになるが、
                    // もし発射されなかった場合のガードが必要ならここに書く
                    // 今回は必ず発射される
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
                const types = ['NORMAL', 'FIRE', 'BOMB'];
                let idx = types.indexOf(p.currentWeapon);
                if (isKeyPressed('KeyW')) idx = (idx + 1) % types.length;
                if (isKeyPressed('KeyS')) idx = (idx - 1 + types.length) % types.length;
                p.currentWeapon = types[idx];
            }

            if (isKeyPressed('Space')) {
                fireProjectile(p);
                isTurnActive = false;
            }
        }
    }

    players.forEach(player => player.update(terrain));
}

function executeCpuTurn(cpu) {
    // CPU Turn Logic
    // 1. ターゲット選択
    const enemies = players.filter(p => p.id !== cpu.id && p.hp > 0);
    if (enemies.length === 0) {
        // 敵がいない場合、適当に撃ってターン終了
        fireProjectile(cpu);
        isTurnActive = false;
        return;
    }

    // ターゲット決定
    const target = enemies[Math.floor(Math.random() * enemies.length)];

    // 2. 武器選択
    if (cpu.inventory['BOMB'] > 0) cpu.currentWeapon = 'BOMB';
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
    fireProjectile(cpu);
    isTurnActive = false;
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
    const vx = Math.cos(-rad) * speed;
    const vy = Math.sin(-rad) * speed;

    const x = player.x + Math.cos(-rad) * 20;
    const y = (player.y - player.height * 0.7) + Math.sin(-rad) * 20;

    projectiles.push(new Projectile(x, y, vx, vy, player.id, player.currentWeapon));

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
    players.forEach(player => player.draw(ctx));
    fires.forEach(f => f.draw(ctx));
    projectiles.forEach(p => p.draw(ctx));
    particles.forEach(p => p.draw(ctx));

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

    ctx.textAlign = 'center';
    ctx.fillText(`Wind: ${wind.toFixed(3)}`, canvas.width / 2, 30);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 50);
    ctx.lineTo(canvas.width / 2 + wind * 500, 50);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 操作ヘルプ（人間の場合のみ）
    if (!p.isCPU) {
        ctx.textAlign = 'right';
        ctx.fillText('Arrows: Aim/Power | A/D: Move | W/S: Weapon', canvas.width - 10, 20);
        ctx.fillText('SPACE: Fire', canvas.width - 10, 40);
    }
}

// ---------------------------
// ショップ
// ---------------------------

function cpuShopLogic(cpu) {
    // 1. HP回復優先
    if (cpu.hp < 50 && cpu.money >= ITEMS.HEALTH.price) {
        buyItem(cpu, 'HEALTH');
    }
    // 2. 強い武器購入
    if (cpu.money >= ITEMS.BOMB.price) {
        buyItem(cpu, 'BOMB');
    }
    if (cpu.money >= ITEMS.FIRE.price) {
        buyItem(cpu, 'FIRE');
    }
}

function updateShop() {
    // 人間プレイヤーの操作
    if (isKeyPressed('KeyQ')) buyItem(players[0], 'FIRE');
    if (isKeyPressed('KeyW')) buyItem(players[0], 'BOMB');

    if (players.length > 1 && players[1] && !players[1].isCPU) {
        if (isKeyPressed('KeyO')) buyItem(players[1], 'FIRE');
        if (isKeyPressed('KeyP')) buyItem(players[1], 'BOMB');
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
        if (type === 'HEALTH') {
            player.hp = Math.min(100, player.hp + 50);
        } else {
            player.inventory[type] = (player.inventory[type] || 0) + 1;
        }
    }
}

function startNextRound() {
    terrain = new Terrain(CONFIG.canvasWidth, CONFIG.canvasHeight);
    randomizeBackground();

    players.forEach((p, index) => {
        p.hp = 100;
        p.x = (CONFIG.canvasWidth / (players.length + 1)) * (index + 1);
        p.y = 0;
        p.angle = index === 1 ? 135 : 45;
    });

    currentPlayerIndex = 0;

    // BUG FIX: ターン状態をリセット
    isTurnActive = true;
    cpuThinking = false;

    currentState = GameState.GAME_LOOP;
}

function drawShop() {
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'white';
    ctx.font = '30px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SHOP', canvas.width / 2, 50);

    ctx.font = '16px monospace';

    // 全プレイヤー表示
    players.forEach((p, i) => {
        let info = `Player ${p.id}`;
        if (p.isCPU) info += " (CPU)";
        info += `: $${p.money} | Fire:${p.inventory.FIRE} Bomb:${p.inventory.BOMB}`;

        ctx.fillStyle = p.color;
        ctx.fillText(info, canvas.width / 2, 100 + i * 30);
    });

    // 操作ヘルプ
    ctx.textAlign = 'left';
    ctx.fillStyle = 'white';
    const startY = 100 + players.length * 30 + 50;

    if (players[0] && !players[0].isCPU) {
        ctx.fillText(`Player 1: [Q] Fire($150) [W] Bomb($300)`, 200, startY);
    }
    if (players[1] && !players[1].isCPU) {
        ctx.fillText(`Player 2: [O] Fire($150) [P] Bomb($300)`, 200, startY + 30);
    }

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
