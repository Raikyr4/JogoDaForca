import { useEffect, useMemo, useRef, useState } from "react";

const PLAYER_STORAGE_KEY = "hangman_player_id";
const NICKNAME_STORAGE_KEY = "hangman_nickname";

function buildWsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}

function reasonLabel(reason) {
  if (reason === "best_of_three") return "Melhor de 3 rodadas";
  if (reason === "best_of_three_draw") return "Empate apos 3 rodadas";
  if (reason === "word_solved") return "Palavra completada";
  if (reason === "max_errors") return "Forca completa (6 erros)";
  if (reason === "full_word_hit") return "Chute correto da palavra";
  if (reason === "wrong_word_guess") return "Chute de palavra errado";
  if (reason === "abandonment") return "Vitoria por abandono";
  return "Partida encerrada";
}

export default function App() {
  const wsUrl = useMemo(() => buildWsUrl(), []);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const manualCloseRef = useRef(false);
  const playerIdRef = useRef(localStorage.getItem(PLAYER_STORAGE_KEY) || "");

  const [phase, setPhase] = useState("name");
  const [isConnected, setIsConnected] = useState(false);

  const [nicknameInput, setNicknameInput] = useState(localStorage.getItem(NICKNAME_STORAGE_KEY) || "");
  const [nickname, setNickname] = useState(localStorage.getItem(NICKNAME_STORAGE_KEY) || "");
  const [playerId, setPlayerId] = useState("");
  const [feedback, setFeedback] = useState("Digite seu nome para entrar na fila");

  const [queuePosition, setQueuePosition] = useState(null);
  const [queueTotal, setQueueTotal] = useState(0);

  const [matchId, setMatchId] = useState("");
  const [opponent, setOpponent] = useState("");
  const [roundNumber, setRoundNumber] = useState(1);
  const [totalRounds, setTotalRounds] = useState(3);
  const [theme, setTheme] = useState("-");
  const [maskedWord, setMaskedWord] = useState("");
  const [correctLetters, setCorrectLetters] = useState([]);
  const [wrongLetters, setWrongLetters] = useState([]);
  const [errors, setErrors] = useState(0);
  const [opponentErrors, setOpponentErrors] = useState(0);
  const [remainingErrors, setRemainingErrors] = useState(6);
  const [isYourTurn, setIsYourTurn] = useState(false);
  const [canGuess, setCanGuess] = useState(false);
  const [yourScore, setYourScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [roundHistory, setRoundHistory] = useState([]);
  const [revealedWord, setRevealedWord] = useState("");
  const [letterInput, setLetterInput] = useState("");
  const [wordInput, setWordInput] = useState("");

  const [winner, setWinner] = useState("");
  const [isDraw, setIsDraw] = useState(false);
  const [gameOverReason, setGameOverReason] = useState("");

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  useEffect(() => {
    if (!playerId) return;
    heartbeatTimerRef.current = window.setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat", player_id: playerId }));
      }
    }, 5000);

    return () => {
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    };
  }, [playerId]);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
      manualCloseRef.current = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
  }

  function clearMatchState() {
    setMatchId("");
    setOpponent("");
    setRoundNumber(1);
    setTotalRounds(3);
    setTheme("-");
    setMaskedWord("");
    setCorrectLetters([]);
    setWrongLetters([]);
    setErrors(0);
    setOpponentErrors(0);
    setRemainingErrors(6);
    setIsYourTurn(false);
    setCanGuess(false);
    setYourScore(0);
    setOpponentScore(0);
    setRoundHistory([]);
    setRevealedWord("");
    setLetterInput("");
    setWordInput("");
    setWinner("");
    setIsDraw(false);
    setGameOverReason("");
  }

  function scheduleReconnect() {
    if (!playerIdRef.current || reconnectTimerRef.current) return;
    const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 5000);
    reconnectAttemptsRef.current += 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      openSocket({ type: "reconnect", player_id: playerIdRef.current });
    }, delay);
  }

  function openSocket(firstMessage) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(firstMessage));
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      clearReconnectTimer();
      ws.send(JSON.stringify(firstMessage));
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      handleServerEvent(payload);
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      if (manualCloseRef.current) {
        manualCloseRef.current = false;
        return;
      }
      if (playerIdRef.current) {
        setPhase("reconnecting");
        setFeedback("Conexao perdida. Tentando reconectar...");
        scheduleReconnect();
      }
    };

    ws.onerror = () => setFeedback("Erro de conexao com servidor");
  }

  function handleServerEvent(payload) {
    if (payload.type === "connected") {
      const id = payload.player_id;
      setPlayerId(id);
      playerIdRef.current = id;
      localStorage.setItem(PLAYER_STORAGE_KEY, id);
      if (nickname) localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
      setPhase("queue");
      setFeedback(payload.message || "Conectado! Entrando na fila.");
      return;
    }

    if (payload.type === "reconnected") {
      setFeedback(payload.message || "Reconectado");
      if (matchId) {
        setPhase("match");
      } else {
        setPhase("queue");
      }
      return;
    }

    if (payload.type === "queue_update") {
      setQueuePosition(payload.position ?? null);
      setQueueTotal(payload.total_waiting || 0);
      setPhase("queue");
      setFeedback(payload.message || "Aguardando adversario");
      return;
    }

    if (payload.type === "match_found") {
      setMatchId(payload.match_id || "");
      setOpponent(payload.opponent || "Adversario");
      setQueuePosition(null);
      setQueueTotal(0);
      if (payload.round_number) setRoundNumber(payload.round_number);
      if (payload.total_rounds) setTotalRounds(payload.total_rounds);
      if (payload.theme) setTheme(payload.theme);
      setPhase("match");
      setFeedback(payload.message || "Partida iniciada");
      return;
    }

    if (payload.type === "game_state") {
      setMatchId(payload.match_id || "");
      setRoundNumber(payload.round_number || 1);
      setTotalRounds(payload.total_rounds || 3);
      setTheme(payload.theme || "-");
      setMaskedWord(payload.masked_word || "");
      setCorrectLetters(payload.correct_letters || []);
      setWrongLetters(payload.wrong_letters || []);
      setErrors(payload.errors || 0);
      setOpponentErrors(payload.opponent_errors || 0);
      setRemainingErrors(payload.remaining_errors || 0);
      setIsYourTurn(Boolean(payload.is_your_turn));
      setCanGuess(Boolean(payload.can_guess));
      setYourScore(payload.your_score || 0);
      setOpponentScore(payload.opponent_score || 0);
      setRoundHistory(payload.round_history || []);
      setRevealedWord(payload.revealed_word || "");
      if (payload.opponent) setOpponent(payload.opponent);
      setPhase(payload.status === "finished" ? "finished" : "match");
      return;
    }

    if (payload.type === "opponent_disconnected") {
      setFeedback(payload.message || "Adversario desconectado");
      return;
    }

    if (payload.type === "game_over") {
      setWinner(payload.winner || "");
      setIsDraw(Boolean(payload.is_draw));
      setGameOverReason(payload.reason || "");
      setYourScore(payload.your_score || 0);
      setOpponentScore(payload.opponent_score || 0);
      if (payload.round_history) setRoundHistory(payload.round_history);
      setPhase("finished");
      if (payload.is_draw) setFeedback("Empate");
      else if (payload.winner && payload.winner === playerIdRef.current) setFeedback("Voce venceu");
      else setFeedback("Voce perdeu");
      return;
    }

    if (payload.type === "error") {
      const message = payload.message || "Erro";
      setFeedback(message);
      if (message.toLowerCase().includes("sessao")) {
        localStorage.removeItem(PLAYER_STORAGE_KEY);
        setPlayerId("");
        playerIdRef.current = "";
        setPhase("name");
      }
    }
  }

  function resetConnectionForNewLogin(options = {}) {
    const { clearPlayerStorage = true } = options;
    clearReconnectTimer();
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    manualCloseRef.current = true;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (clearPlayerStorage) localStorage.removeItem(PLAYER_STORAGE_KEY);
    setPlayerId("");
    playerIdRef.current = "";
    setQueuePosition(null);
    setQueueTotal(0);
    clearMatchState();
    setIsConnected(false);
  }

  function handleEnter(event) {
    event.preventDefault();
    const cleanName = nicknameInput.trim();
    if (!cleanName) {
      setFeedback("Informe um nome valido");
      return;
    }

    const storedPlayerId = localStorage.getItem(PLAYER_STORAGE_KEY) || "";
    const storedNickname = localStorage.getItem(NICKNAME_STORAGE_KEY) || "";
    const shouldTryReconnect = Boolean(storedPlayerId) && storedNickname.toLowerCase() === cleanName.toLowerCase();

    if (shouldTryReconnect) {
      resetConnectionForNewLogin({ clearPlayerStorage: false });
      setNickname(cleanName);
      setPlayerId(storedPlayerId);
      playerIdRef.current = storedPlayerId;
      setPhase("reconnecting");
      setFeedback("Tentando restaurar sua sessao...");
      openSocket({ type: "reconnect", player_id: storedPlayerId });
      return;
    }

    resetConnectionForNewLogin();
    setNickname(cleanName);
    localStorage.setItem(NICKNAME_STORAGE_KEY, cleanName);
    setFeedback("Conectando...");
    openSocket({ type: "register_player", nickname: cleanName });
  }

  function handleSwitchUser() {
    resetConnectionForNewLogin();
    setNickname("");
    setNicknameInput("");
    localStorage.removeItem(NICKNAME_STORAGE_KEY);
    setPhase("name");
    setFeedback("Digite seu nome para entrar na fila");
  }

  function handleGuessLetter(event) {
    event.preventDefault();
    const letter = letterInput.trim().slice(0, 1).toUpperCase();
    if (!letter || !playerId || !matchId) return;
    if (!(wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) return;
    wsRef.current.send(JSON.stringify({ type: "guess_letter", player_id: playerId, match_id: matchId, letter }));
    setLetterInput("");
  }

  function handleGuessWord(event) {
    event.preventDefault();
    const word = wordInput.trim().toUpperCase();
    if (!word || !playerId || !matchId) return;
    if (!(wsRef.current && wsRef.current.readyState === WebSocket.OPEN)) return;
    wsRef.current.send(JSON.stringify({ type: "guess_word", player_id: playerId, match_id: matchId, word }));
    setWordInput("");
  }

  function playAgain() {
    clearMatchState();
    setQueuePosition(null);
    setQueueTotal(0);
    setPhase("queue");
    setFeedback("Voltando para a fila automaticamente...");
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && playerId) {
      wsRef.current.send(JSON.stringify({ type: "join_queue", player_id: playerId }));
    }
  }

  const youWon = winner && winner === playerId;

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="topbar">
          <div>
            <h1>Forca Arena Distribuida</h1>
            <p className="subtitle">Fluxo automatico: conexao - fila - partida em pares de jogadores</p>
          </div>
          <div className="topbar-actions">
            <div className={`status ${isConnected ? "online" : "offline"}`}>{isConnected ? "Conectado" : "Desconectado"}</div>
            {playerId && (
              <button type="button" className="ghost-button" onClick={handleSwitchUser}>
                Trocar jogador
              </button>
            )}
          </div>
        </header>

        <p className="feedback">{feedback}</p>

        {phase === "name" && (
          <section className="hero-card">
            <h2>Entrar no jogo</h2>
            <p>Digite seu nome. O servidor coloca voce na fila e forma partidas com 2 jogadores automaticamente.</p>
            <form className="entry-form" onSubmit={handleEnter}>
              <label htmlFor="nickname">Nome do jogador</label>
              <input
                id="nickname"
                value={nicknameInput}
                onChange={(event) => setNicknameInput(event.target.value)}
                placeholder="Ex: Pedro"
                maxLength={24}
                required
              />
              <button type="submit">Entrar</button>
            </form>
          </section>
        )}

        {(phase === "queue" || phase === "reconnecting") && (
          <section className="hero-card">
            <h2>{phase === "reconnecting" ? "Reconectando" : "Fila de espera"}</h2>
            <p>
              Jogador: <strong>{nickname || "-"}</strong>
            </p>
            {phase === "reconnecting" ? (
              <p className="muted">Tentando restaurar sessao...</p>
            ) : (
              <>
                <p>Posicao na fila: <strong>{queuePosition || "calculando..."}</strong></p>
                <p>Jogadores aguardando: <strong>{queueTotal}</strong></p>
                <p className="muted">Quando entrar um adversario, a partida inicia automaticamente.</p>
              </>
            )}
          </section>
        )}

        {phase === "match" && (
          <section className="game-layout">
            <div className="board">
              <h2>Partida</h2>
              <p>Adversario: <strong>{opponent || "..."}</strong></p>
              <p>
                Rodada: <strong>{roundNumber}/{totalRounds}</strong>
              </p>
              <p>Tema: <strong>{theme}</strong></p>

              <div className="score-row">
                <div>
                  <small>Seu placar</small>
                  <strong>{yourScore}</strong>
                </div>
                <div>
                  <small>Placar do adversario</small>
                  <strong>{opponentScore}</strong>
                </div>
              </div>

              <p className={`turn-label ${isYourTurn ? "my-turn" : ""}`}>{isYourTurn ? "Sua vez de jogar" : "Vez do adversario"}</p>

              <p className="masked-word">{maskedWord || "_ _ _ _"}</p>
              <p>Letras certas: {correctLetters.join(", ") || "-"}</p>
              <p>Letras erradas: {wrongLetters.join(", ") || "-"}</p>
              <p>Erros: {errors}/6 (restam {remainingErrors})</p>
              <p>Erros do adversario: {opponentErrors}/6</p>

              <form className="guess-form" onSubmit={handleGuessLetter}>
                <input
                  placeholder="Letra"
                  value={letterInput}
                  onChange={(event) => setLetterInput(event.target.value.toUpperCase())}
                  maxLength={1}
                  required
                  disabled={!canGuess}
                />
                <button type="submit" disabled={!canGuess}>Jogar letra</button>
              </form>

              <form className="guess-word-form" onSubmit={handleGuessWord}>
                <input
                  placeholder="Chutar palavra"
                  value={wordInput}
                  onChange={(event) => setWordInput(event.target.value.toUpperCase())}
                  maxLength={32}
                  required
                  disabled={!canGuess}
                />
                <button type="submit" className="danger" disabled={!canGuess}>Chutar palavra</button>
              </form>
              <p className="warning">Se errar o chute de palavra, voce perde a partida automaticamente.</p>
            </div>

            <div className="hangman-box">
              <h3>Forca</h3>
              <HangmanGraphic errors={errors} />
              <p className="hangman-label">Tema da rodada: {theme}</p>
            </div>
          </section>
        )}

        {phase === "finished" && (
          <section className="end-box">
            <h2>{isDraw ? "Empate" : youWon ? "Voce venceu" : "Voce perdeu"}</h2>
            <p>Motivo: {reasonLabel(gameOverReason)}</p>
            <p>Placar final: <strong>{yourScore}</strong> x <strong>{opponentScore}</strong></p>
            {revealedWord && <p>Ultima palavra: <strong>{revealedWord}</strong></p>}
            <div className="history">
              {roundHistory.length > 0 &&
                roundHistory.map((round) => (
                  <div className="history-item" key={`round-${round.round_number}`}>
                    <strong>Rodada {round.round_number}</strong>
                    <span>Tema: {round.theme} | Palavra: {round.word}</span>
                    <span>Vencedor: {round.winner_nickname || "Ninguem"} | Motivo: {reasonLabel(round.reason)}</span>
                  </div>
                ))}
            </div>
            <button type="button" onClick={playAgain}>Jogar novamente</button>
          </section>
        )}
      </section>
    </main>
  );
}

function HangmanGraphic({ errors }) {
  const safeErrors = Math.max(0, Math.min(6, Number(errors) || 0));
  return (
    <svg viewBox="0 0 240 250" className="hangman-svg" role="img" aria-label={`Forca com ${safeErrors} erros`}>
      <line className="scaffold" x1="20" y1="230" x2="220" y2="230" />
      <line className="scaffold" x1="60" y1="230" x2="60" y2="24" />
      <line className="scaffold" x1="60" y1="24" x2="150" y2="24" />
      <line className="scaffold" x1="150" y1="24" x2="150" y2="48" />

      <circle className={`hangman-part ${safeErrors >= 1 ? "visible" : ""}`} cx="150" cy="68" r="20" />
      <line className={`hangman-part ${safeErrors >= 2 ? "visible" : ""}`} x1="150" y1="88" x2="150" y2="145" />
      <line className={`hangman-part ${safeErrors >= 3 ? "visible" : ""}`} x1="150" y1="105" x2="185" y2="125" />
      <line className={`hangman-part ${safeErrors >= 4 ? "visible" : ""}`} x1="150" y1="105" x2="115" y2="125" />
      <line className={`hangman-part ${safeErrors >= 5 ? "visible" : ""}`} x1="150" y1="145" x2="180" y2="188" />
      <line className={`hangman-part ${safeErrors >= 6 ? "visible" : ""}`} x1="150" y1="145" x2="120" y2="188" />
    </svg>
  );
}
