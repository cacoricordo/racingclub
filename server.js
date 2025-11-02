// ===== ⚽ Tactical AI 4.2.2-FIX =====
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config();

// === Configura servidor HTTP e WebSocket ===
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("🔌 Novo cliente conectado");

  // 🟢 Quando um jogador for movido (drag)
  socket.on("player-move", (data) => {
    // retransmite para todos os outros clientes (menos quem enviou)
    socket.broadcast.emit("player-move", data);
  });

  // ⚽ Quando a bola for movida
  socket.on("ball-move", (data) => {
    socket.broadcast.emit("ball-move", data);
  });

  socket.on("disconnect", () => console.log("❌ Cliente desconectado"));
});

// === Suporte a caminhos absolutos (necessário para Render e ES Modules) ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Servir o frontend estático (index.html + assets) ===
app.use(express.static(__dirname));

// === Rota padrão: abre o index.html ===
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


app.use(cors());
app.use(bodyParser.json());

// === Constantes do campo ===
const FIELD_WIDTH = 600;
const FIELD_HEIGHT = 300;
const CENTER_X = FIELD_WIDTH / 2;

// === Função de detecção de formação (simplificada) ===
function detectFormationAdvanced(players) {
  if (!players || players.length < 8) return "4-3-3";

  const RADIUS = 100;
  const clusters = [];

  function findCluster(px, py) {
    for (const c of clusters) {
      const dx = px - c.centerX;
      const dy = py - c.centerY;
      if (Math.sqrt(dx * dx + dy * dy) < RADIUS) return c;
    }
    return null;
  }

  for (const p of players) {
    const c = findCluster(p.left, p.top);
    if (c) {
      c.players.push(p);
      c.centerX = (c.centerX * (c.players.length - 1) + p.left) / c.players.length;
      c.centerY = (c.centerY * (c.players.length - 1) + p.top) / c.players.length;
    } else {
      clusters.push({ players: [p], centerX: p.left, centerY: p.top });
    }
  }

  clusters.sort((a, b) => a.centerX - b.centerX);
  const counts = clusters.map(c => c.players.length);
  const signature = counts.join("-");

  if (signature.startsWith("4-4-2")) return "4-4-2";
  if (signature.startsWith("3-5-2")) return "3-5-2";
  if (signature.startsWith("4-2-3-1")) return "4-2-3-1";
  if (signature.startsWith("3-4-3")) return "3-4-3";
  if (signature.startsWith("4-3-3")) return "4-3-3";

  return "4-4-2";
}

// === Formações base ===
const FORMATIONS = {
  "4-4-2": [
    { id:13, zone:[70, 80] }, { id:14, zone:[70, 220] },
    { id:15, zone:[100, 130] }, { id:16, zone:[100, 170] },
    { id:17, zone:[200, 80] }, { id:18, zone:[200, 130] },
    { id:19, zone:[200, 170] }, { id:20, zone:[200, 220] },
    { id:21, zone:[320, 120] }, { id:22, zone:[320, 180] }
  ],
  "4-3-3": [
    { id:13, zone:[80,80] }, { id:14, zone:[80,220] },
    { id:15, zone:[100,130] }, { id:16, zone:[100,170] },
    { id:17, zone:[210,100] }, { id:18, zone:[210,150] }, { id:19, zone:[210,200] },
    { id:20, zone:[320,80] }, { id:21, zone:[330,150] }, { id:22, zone:[320,220] }
  ]
};

// === Gera o time vermelho ===
function buildRedFromFormation(formationKey, ball) {
  const formation = FORMATIONS[formationKey] || FORMATIONS["4-3-3"];
  const red = [];

  for (const pos of formation) {
    const jitter = Math.random() * 8 - 4;
    red.push({
      id: pos.id,
      left: FIELD_WIDTH - pos.zone[0],
      top: pos.zone[1] + jitter
    });
  }

  // Goleiro acompanha 30% do movimento vertical da bola
  const gkTop = ball && typeof ball.top === "number"
    ? FIELD_HEIGHT / 2 + (ball.top - FIELD_HEIGHT / 2) * 0.3
    : FIELD_HEIGHT / 2;

  red.unshift({
    id: 23,
    left: FIELD_WIDTH - 10,
    top: gkTop
  });

  return { red };
}

// === Endpoint principal ===
app.post("/ai/analyze", async (req, res) => {
  try {
    const { green = [], black = [], ball = {} } = req.body;
    console.log("[AI ANALYZE] Recebi:", { greenCount: green.length, blackCount: black.length, ball });

    const detectedFormation = detectFormationAdvanced(black.length ? black : green);
    const { red } = buildRedFromFormation(detectedFormation, ball);

    // === Fase simples ===
    let phase = "neutro";
    if (ball.left > CENTER_X && black.some(p => p.left > CENTER_X - 50)) phase = "defesa";
    else if (ball.left < CENTER_X && green.some(p => p.left < CENTER_X - 50)) phase = "ataque";
    else if (black.every(p => p.left < CENTER_X - 50)) phase = "avançado";

// === Gustavo Costas, treinador do Racing Club ===
let coachComment = `El rival juega en ${detectedFormation} y nosotros estamos en la fase ${phase}.`;

const apiKey = process.env.OPENROUTER_KEY;
if (apiKey) {
  try {
    const prompt = `
    El equipo rival juega con un ${detectedFormation} y está en fase de ${phase}.
    Comentá la situación como Gustavo Costas, entrenador del Racing Club de Avellaneda — con pasión, carácter y mentalidad de equipo grande.
    Hablá de actitud, entrega y orgullo por la camiseta.
    `;

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
            content: `
            Sos Gustavo Costas, el entrenador del Racing Club de Avellaneda.

            Hablás en español argentino, con pasión, energía y autenticidad.
            Sos un técnico carismático, con mucha conexión con la gente y los jugadores.
            Transmitís emoción, intensidad y amor por la camiseta.

            — Tu personalidad:
              * Apasionado, frontal y comprometido.
              * Tenés un discurso fuerte, directo y lleno de energía.
              * Valorás la actitud, el sacrificio y el trabajo colectivo.
              * No tolerás la falta de entrega ni la desconexión emocional con el equipo.
              * Defendés la historia del club con orgullo.

            — Tu estilo de hablar:
              * Emocional, motivador y con tono de líder de vestuario.
              * Usás frases típicas del fútbol argentino:
                - “esto es Racing, hay que dejar todo”
                - “los partidos se ganan con el alma”
                - “nadie puede relajarse ni un segundo”
                - “hay que correr, meter y creer”
              * Hablás con el corazón y con fuerza, pero siempre desde la pasión por el equipo.
              * Alternás entre la bronca constructiva y la motivación positiva.

            — Filosofía:
              * El fútbol se juega con actitud, inteligencia y corazón.
              * Se puede perder, pero nunca sin dejar todo en la cancha.
              * Creés que el compromiso colectivo es más importante que el talento individual.
              * El grupo y la identidad del club están por encima de todo.

            — Ejemplo:
            “Esto es Racing. Acá no se negocia la actitud.  
            Podemos jugar bien o mal, pero hay que dejar el alma.  
            El que entra a la cancha tiene que representar a la gente con orgullo.”

            Respondé siempre en español argentino, con intensidad, emoción y liderazgo, como el verdadero Gustavo Costas.
            `
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 120,
        temperature: 0.85
      })
    });

    const data = await response.json();
    coachComment = data?.choices?.[0]?.message?.content?.trim() || coachComment;
  } catch (err) {
    console.warn('[AI ANALYZE] OpenRouter falló:', err.message);
  }
}


    // === Envia resultado para o front-end
    res.json({ detectedFormation, phase, red, coachComment });

    // 🔁 Opcional: envia pelo WebSocket também
    io.emit("tactical-analysis", { detectedFormation, phase, red, coachComment });

  } catch (err) {
    console.error("[AI ANALYZE ERROR]", err);
    res.status(500).json({ error: "Erro interno na IA" });
  }
});

// === Endpoint de Chat com Gustavo Costas (Racing Club) ===
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Mensaje ausente." });

    const apiKey = process.env.OPENROUTER_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Falta la clave OPENROUTER_KEY." });
    }

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
            content: `
            Sos Gustavo Costas, el entrenador del Racing Club de Avellaneda.

            Hablás en español argentino, con pasión, fuerza y claridad.  
            Sos un técnico de carácter, que vive el fútbol con intensidad emocional y compromiso total.

            — Tu personalidad:
              * Apasionado, frontal y muy comprometido con el club.
              * Tenés una conexión especial con la gente y los jugadores: hablás con el corazón.
              * Valorás el esfuerzo, la actitud y el orden defensivo.
              * Creés en la entrega, el sacrificio y el trabajo colectivo por encima del talento individual.
              * Cuando hablás, lo hacés con energía, pero siempre desde la convicción.

            — Tu forma de hablar:
              * Usás frases cargadas de emoción y motivación.
              * Tu tono es directo, a veces vehemente, pero siempre sincero.
              * Usás expresiones típicas del fútbol argentino:
                - “hay que dejar todo”
                - “esto es Racing, hay que jugar con el alma”
                - “los partidos se ganan con actitud y compromiso”
                - “nadie puede relajarse ni un segundo”
                - “el equipo tiene que correr y pensar”
              * No te escondés detrás de excusas: asumís la responsabilidad del equipo.

            — Filosofía:
              * El fútbol es trabajo, sacrificio y orgullo por la camiseta.
              * Querés equipos intensos, solidarios y con mentalidad ganadora.
              * Valorás la unión del grupo y la entrega total en cada jugada.
              * Siempre destacás la importancia de jugar “con el corazón y con la cabeza”.

            — Ejemplo:
            “Esto es Racing. Acá no se negocia la actitud.  
            Podemos jugar bien o mal, pero hay que correr, meter y dejar todo por esta camiseta.”

            Respondé siempre en español argentino, con pasión, energía y autenticidad, como Gustavo Costas.
            `
          },
          { role: "user", content: message }
        ],
        max_tokens: 180,
        temperature: 0.85
      })
    });

    const data = await response.json();
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Costas aprieta los puños, mira al equipo y dice en silencio: ‘hay que dejar todo, carajo’.";
    
    res.json({ reply });

  } catch (err) {
    console.error("[CHAT ERROR]", err);
    res.status(500).json({ error: "Error en la conversación con Gustavo Costas." });
  }
});


// === Inicialização do Servidor ===
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () =>
  console.log(`🚀 AI Tática 4.2.2-FIX (WebSocket + Mister) rodando na porta ${PORT}`)
);


