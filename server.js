// ==========================
//  OS INVICTOS SERVER ⚽
//  Integra campo tático + AI + Chat do "Treinador Português"
// ==========================

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

// ======= ⚙️ CORS GLOBAL =======
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // ✅ Permite tudo
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

const server = http.createServer(app);

// ======= ⚽ Socket.IO =======
const io = new Server(server, {
  transports: ["websocket", "polling"], // força compatibilidade com Render
  cors: {
    origin: "*", // ✅ libera todos os domínios
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  }
});

io.on('connection', (socket) => {
  console.log('🔌 Novo cliente conectado');

  socket.on('move_circle', (data) => {
    socket.broadcast.emit('update_circle', data);
  });

  socket.on('path_draw', (data) => {
    socket.broadcast.emit('path_draw', data);
  });

  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado');
  });
});

// ======= 🤖 AI Análise 3.0 =======
app.post('/ai/analyze-tactical', (req, res) => {
  const { ball, green, black } = req.body;

  // --- Detectar formação adversária ---
  const avgY = black ? black.map(p => p.top) : [];
  let detectedFormation = "4-3-3";
  if (avgY.length) {
    const minY = Math.min(...avgY);
    const maxY = Math.max(...avgY);
    const spread = maxY - minY;
    if (spread < 200) detectedFormation = "4-4-2";
    else if (spread < 300) detectedFormation = "3-5-2";
  }

  // --- Formações padrão do time vermelho ---
  const tacticalFormations = {
    "4-4-2": [
      { id: 13, left: 100, top: 220 },
      { id: 14, left: 150, top: 180 },
      { id: 15, left: 150, top: 260 },
      { id: 16, left: 100, top: 300 },
      { id: 17, left: 250, top: 200 },
      { id: 18, left: 250, top: 280 },
      { id: 19, left: 350, top: 180 },
      { id: 20, left: 350, top: 300 },
      { id: 21, left: 450, top: 210 },
      { id: 22, left: 450, top: 280 }
    ],
    "4-3-3": [
      { id: 13, left: 100, top: 220 },
      { id: 14, left: 150, top: 180 },
      { id: 15, left: 150, top: 260 },
      { id: 16, left: 100, top: 300 },
      { id: 17, left: 250, top: 180 },
      { id: 18, left: 250, top: 260 },
      { id: 19, left: 300, top: 220 },
      { id: 20, left: 400, top: 160 },
      { id: 21, left: 400, top: 240 },
      { id: 22, left: 400, top: 320 }
    ],
    "3-5-2": [
      { id: 13, left: 150, top: 200 },
      { id: 14, left: 150, top: 260 },
      { id: 15, left: 150, top: 320 },
      { id: 16, left: 250, top: 160 },
      { id: 17, left: 250, top: 220 },
      { id: 18, left: 250, top: 280 },
      { id: 19, left: 350, top: 200 },
      { id: 20, left: 350, top: 260 },
      { id: 21, left: 450, top: 180 },
      { id: 22, left: 450, top: 300 }
    ]
  };

  // --- Escolher resposta tática do vermelho ---
  const recommendedFormation = (detectedFormation === "4-3-3") ? "4-4-2" :
                               (detectedFormation === "3-5-2") ? "4-3-3" :
                               "3-5-2";

  let red = tacticalFormations[recommendedFormation];

  // --- Ajuste leve à bola ---
  if (ball && ball.left && ball.top) {
    const adjustX = (ball.left - 300) * 0.1;
    const adjustY = (ball.top - 250) * 0.05;
    red = red.map(p => ({
      ...p,
      left: p.left + adjustX,
      top: p.top + adjustY
    }));
  }

  // --- Novo: posicionamento adaptativo do time verde em relação ao time preto ---
  const greenAdjusted = [];
  if (black && black.length) {
    for (let i = 0; i < Math.min(black.length, 11); i++) {
      const opp = black[i];
      // Cada jogador verde se posiciona 40px atrás e 10px deslocado lateralmente
      greenAdjusted.push({
        id: i + 1,
        left: opp.left - 40,
        top: opp.top + ((i % 2 === 0) ? -10 : 10)
      });
    }
  } else if (green) {
    // fallback: mantém posições originais
    greenAdjusted.push(...green);
  }

  res.json({
    detectedFormation,
    recommendedFormation,
    red,
    greenAdjusted
  });
});


// ======= 🧠 Chat (OpenRouter) =======
app.post('/api/chat', async (req, res) => {
  const message = req.body.message;
  const apiKey = process.env.OPENROUTER_KEY;

  if (!apiKey) {
    return res.status(500).json({ reply: "Erro interno: OPENROUTER_KEY não configurada." });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Tu és um treinador português lendário, sarcástico, confiante e direto. Foste campeão no Porto, Chelsea, Inter, Real Madrid e Manchester United. Fala com autoridade, ironia e sempre como se fosses o centro das atenções."
          },
          { role: "user", content: message }
        ],
        max_tokens: 200,
        temperature: 0.9
      }),
    });

    const data = await response.json();
    const reply =
      data.choices?.[0]?.message?.content?.trim() ||
      "O mister não tem tempo pra conversa fiada.";
    res.json({ reply });
  } catch (err) {
    console.error("Erro no OpenRouter:", err);
    res.json({ reply: "O mister não respondeu... deve estar irritado com o árbitro." });
  }
});

// ======= 🚀 Start =======
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🏟️  Servidor rodando na porta ${PORT}`);
});

