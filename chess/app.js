/**
 * P2P Chess Game Implementation using js-chess-engine
 */

/** @typedef {import('pear-interface')} */
/* global Pear */

import Hyperswarm from "hyperswarm";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import { Game } from "js-chess-engine";

const { teardown, updates } = Pear;

// Initialize P2P networking
const swarm = new Hyperswarm();

// Game state variables
const gameState = {
  stage: "room-selection",
  username: null,
  playerColor: null,
  opponentInfo: {
    username: null,
    color: null,
  },
  gameStarted: false,
  roomCode: null,
  isRoomCreator: false,
  game: null,
  selectedPiece: null,
  gameMode: null, // 'blitz' or 'rapid'
  timers: {
    white: null, // time in seconds
    black: null,
    activeTimer: null, // interval ID for the active timer
    lastMoveTime: null, // timestamp of the last move
  },
  matchmaking: {
    topic: null,
    searching: false,
    publicRoomPrefix: "chess-public-",
    roomNumber: null,
  },
};

// Cleanup handlers
teardown(() => swarm.destroy());
updates(() => Pear.reload());

/**
 * Debug utility to display messages in the debug panel
 */
function debug(message, type = "info") {
  const debugPanel = document.getElementById("debug-panel");
  if (!debugPanel) return;

  const entry = document.createElement("div");
  entry.className = `debug-entry ${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
  debugPanel.appendChild(entry);
  debugPanel.scrollTop = debugPanel.scrollHeight;
  console.log(`[${type}] ${message}`);

  while (debugPanel.children.length > 50) {
    debugPanel.removeChild(debugPanel.firstChild);
  }
}

// Initialize UI when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  try {
    debug("Initializing game UI...");
    initializeUI();
    setupEventListeners();
    initializeTheme();
    debug("Game UI initialized successfully", "success");
  } catch (error) {
    debug(`Error initializing game UI: ${error.message}`, "error");
    console.error("Initialization error:", error);
  }
});

// Theme functionality
function initializeTheme() {
  const theme = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
}

function showStage(stageName) {
  try {
    debug(`Attempting to show stage: ${stageName}`);
    const stages = document.querySelectorAll(".stage");
    stages.forEach((stage) => stage.classList.add("hidden"));
    const targetStage = document.getElementById(`stage-${stageName}`);
    if (!targetStage) throw new Error(`Stage not found: ${stageName}`);
    targetStage.classList.remove("hidden");
    gameState.stage = stageName;
    debug(`Successfully switched to stage: ${stageName}`, "success");
  } catch (error) {
    debug(`Error showing stage ${stageName}: ${error.message}`, "error");
  }
}

function initializeUI() {
  playSound("gameBackgroundSound");
  const requiredElements = [
    "debug-panel",
    "stage-room-selection",
    "stage-room-setup",
    "stage-game",
    "loading",
  ];

  const missingElements = requiredElements.filter(
    (id) => !document.getElementById(id)
  );
  if (missingElements.length) {
    throw new Error(`Missing required elements: ${missingElements.join(", ")}`);
  }

  showStage("room-selection");
}

function setupEventListeners() {
  try {
    // Room Selection Stage
    const createRoomBtn = document.getElementById("create-room-btn");
    const joinRoomBtn = document.getElementById("join-room-btn");

    createRoomBtn.addEventListener("click", () => {
      showStage("room-setup");
      document.getElementById("create-room-form").classList.remove("hidden");
      document.getElementById("join-room-form").classList.add("hidden");
    });

    joinRoomBtn.addEventListener("click", () => {
      showStage("room-setup");
      document.getElementById("join-room-form").classList.remove("hidden");
      document.getElementById("create-room-form").classList.add("hidden");
    });

    setupRoomEventListeners();
    setupGameInterfaceListeners();
    debug("Event listeners setup completed", "success");

    const playStrangerBtn = document.getElementById("play-stranger-btn");
    playStrangerBtn.addEventListener("click", startMatchmaking);
  } catch (error) {
    debug(`Error setting up event listeners: ${error.message}`, "error");
  }
}

// Add these new functions for matchmaking
async function startMatchmaking() {
  try {
    debug("Starting matchmaking process...", "info");
    showLoading("Finding opponent...");
    gameState.matchmaking.searching = true;

    debug("Requesting username for matchmaking...", "info");
    // Get username first
    const username = await getUsernameForMatchmaking();
    if (!username) {
      debug("Matchmaking cancelled - no username provided", "info");
      hideLoading();
      return;
    }
    gameState.username = username;
    debug(`Username set: ${username}`, "success");

    debug("Beginning opponent search...", "info");
    // Start searching for opponent
    searchForOpponent();
  } catch (error) {
    debug(`Matchmaking error: ${error.message}`, "error");
    hideLoading();
  }
}

function getUsernameForMatchmaking() {
  return new Promise((resolve) => {
    // Create modal for username input
    const modal = document.createElement("div");
    modal.className = "modal visible";
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Enter Your Username</h2>
        </div>
        <div class="modal-body">
          <input type="text" id="matchmaking-username" 
                 placeholder="Enter username" class="form-input"
                 style="width: 100%; margin-bottom: 20px;">
        </div>
        <div class="modal-footer">
          <button id="start-matchmaking" class="primary-btn">Start Matchmaking</button>
          <button id="cancel-matchmaking" class="secondary-btn">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const usernameInput = modal.querySelector("#matchmaking-username");
    const startButton = modal.querySelector("#start-matchmaking");
    const cancelButton = modal.querySelector("#cancel-matchmaking");

    startButton.addEventListener("click", () => {
      const username = usernameInput.value.trim();
      if (username) {
        document.body.removeChild(modal);
        resolve(username);
      } else {
        usernameInput.classList.add("error");
      }
    });

    cancelButton.addEventListener("click", () => {
      document.body.removeChild(modal);
      resolve(null);
    });

    usernameInput.focus();
  });
}

async function searchForOpponent() {
  try {
    debug("Initializing public room search...", "info");
    // Generate room numbers 1-10 for public matchmaking
    const publicRooms = Array.from({ length: 3 }, (_, i) => i + 1);
    let foundMatch = false;

    // Try joining each public room
    for (const roomNum of publicRooms) {
      if (foundMatch) break;

      debug(`Attempting to join public room ${roomNum}...`, "info");
      const roomTopic = generatePublicRoomTopic(roomNum);
      gameState.matchmaking.roomNumber = roomNum;

      try {
        // Try to join the room
        debug(
          `Joining room ${roomNum} with topic: ${b4a.toString(
            roomTopic,
            "hex"
          )}`,
          "info"
        );

        const discovery = swarm.join(roomTopic, { client: true, server: true });
        await discovery.flushed();

        debug(`Successfully joined room ${roomNum}`, "success");

        debug(`Waiting for opponent in room ${roomNum}...`, "info");
        // Wait a short time to see if we connect to an opponent
        await new Promise((resolve) => setTimeout(resolve, 5000));

        if (swarm.connections.size > 0) {
          // Found an opponent
          foundMatch = true;
          gameState.matchmaking.topic = roomTopic;
          debug(`Matched in public room ${roomNum}`, "success");
          debug(
            `Successfully matched with opponent in room ${roomNum}!`,
            "success"
          );
          debug(`Current connections: ${swarm.connections.size}`, "info");
          return;
        } else {
          debug(`No opponent found in room ${roomNum}, leaving...`, "info");

          // No opponent found, leave this room
          swarm.leave(roomTopic);
          debug(`Left room ${roomNum}`, "info");
        }
      } catch (err) {
        debug(`Failed to join public room ${roomNum}: ${err.message}`, "error");
        continue;
      }
    }
    if (!foundMatch) {
      // If no match found, create a new room and wait
      const roomNum = Math.floor(Math.random() * 3) + 1;
      debug(
        `No match found in existing rooms. Creating new room ${roomNum}...`,
        "info"
      );

      const roomTopic = generatePublicRoomTopic(roomNum);
      gameState.matchmaking.roomNumber = roomNum;
      gameState.matchmaking.topic = roomTopic;

      debug(
        `Joining new room ${roomNum} with topic: ${b4a.toString(
          roomTopic,
          "hex"
        )}`,
        "info"
      );

      const discovery = swarm.join(roomTopic, { client: true, server: true });
      await discovery.flushed();

      debug(`Successfully created and joined room ${roomNum}`, "success");

      gameState.isRoomCreator = true;
      gameState.gameMode = "blitz";
      showLoading("Waiting for opponent...");
      debug("Waiting for opponent to join...", "info");
    }
  } catch (error) {
    debug(`Matchmaking error: ${error.message}`, "error");
    hideLoading();
  }
}

function generatePublicRoomTopic(roomNumber) {
  // Create a consistent topic for public rooms
  const publicRoomId = `${gameState.matchmaking.publicRoomPrefix}${roomNumber}`;
  //return crypto.createHash('sha256').update(publicRoomId).digest();
  debug(`Generating topic for public room ID: ${publicRoomId}`, "info");

  const buffer = b4a.from(publicRoomId);
  const topic = crypto.data(buffer);

  debug(`Generated topic: ${b4a.toString(topic, "hex")}`, "info");
  return topic;
}

function setupRoomEventListeners() {
  const createRoomSubmit = document.getElementById("create-room-submit");
  const joinRoomSubmit = document.getElementById("join-room-submit");
  const copyRoomCode = document.getElementById("copy-room-code");
  setupGameModeListeners();

  createRoomSubmit.addEventListener("click", async (e) => {
    e.preventDefault();
    const username = document.getElementById("create-username").value.trim();
    if (!username) {
      debug("Username is required", "error");
      return;
    }

    gameState.username = username;
    gameState.isRoomCreator = true;

    const topicBuffer = crypto.randomBytes(32);
    gameState.roomCode = b4a.toString(topicBuffer, "hex");

    document.getElementById("room-code-display").value = gameState.roomCode;
    document
      .getElementById("room-code-display-container")
      .classList.remove("hidden");
    createRoomSubmit.classList.add("hidden");
    await joinSwarm(topicBuffer);
  });

  // Add game mode selection listeners
  function setupGameModeListeners() {
    const blitzBtn = document.getElementById("select-blitz");
    const rapidBtn = document.getElementById("select-rapid");

    blitzBtn.addEventListener("click", () => {
      // Add selected style to clicked button
      blitzBtn.classList.add("selected");
      rapidBtn.classList.remove("selected");
      selectGameMode("blitz");
    });

    rapidBtn.addEventListener("click", () => {
      // Add selected style to clicked button
      rapidBtn.classList.add("selected");
      blitzBtn.classList.remove("selected");
      selectGameMode("rapid");
    });
  }

  function selectGameMode(mode) {
    gameState.gameMode = mode;
    debug(`Selected game mode: ${mode}`, "info");

    // Set timer values based on mode
    if (mode === "blitz") {
      gameState.timers.white = 5 * 60; // 5 minutes in seconds
      gameState.timers.black = 5 * 60;
    } else {
      gameState.timers.white = 25 * 60; // 25 minutes in seconds
      gameState.timers.black = 25 * 60;
    }
  }

  joinRoomSubmit.addEventListener("click", async (e) => {
    e.preventDefault();
    const username = document.getElementById("join-username").value.trim();
    const roomCode = document.getElementById("room-code-input").value.trim();

    if (!username || !roomCode) {
      debug("Username and room code are required", "error");
      return;
    }

    gameState.username = username;
    gameState.roomCode = roomCode;

    try {
      const topicBuffer = b4a.from(roomCode, "hex");
      await joinSwarm(topicBuffer);
    } catch (err) {
      debug("Invalid room code", "error");
    }
  });

  copyRoomCode.addEventListener("click", async () => {
    const roomCode = document.getElementById("room-code-display").value;
    await navigator.clipboard.writeText(roomCode);
    debug("Room code copied to clipboard", "success");
  });
}

function setupGameInterfaceListeners() {
  const messageForm = document.getElementById("message-form");
  messageForm.addEventListener("submit", sendMessage);

  const chessBoard = document.getElementById("chess-board");
  chessBoard.addEventListener("click", handleBoardClick);
}

// P2P Communication
swarm.on("connection", (peer) => {
  debug(`New peer connection established`, "success");
  debug(`Current connections: ${swarm.connections.size}`, "info");

  if (swarm.connections.size > 1) {
    debug("More than one connection, destroying peer", "info");
    peer.destroy();
    return;
  }

  debug("Peer connected", "success");

  // Hide loading screen immediately when connection is established
  hideLoading();

  // if (gameState.matchmaking.searching) {
  //   debug("Connection established during matchmaking", "success");

  //   gameState.playerColor = "white";
  //   gameState.opponentInfo.color = "black";
  //   debug(`Assigned colors - Player: ${gameState.playerColor}, Opponent: ${gameState.opponentInfo.color}`, "info");

  //   

  //   // Send game mode to joiner
  //   const modeMessage = {
  //     type: "mode",
  //     mode: "blitz",
  //   };
  //   peer.write(b4a.from(JSON.stringify(modeMessage)));
  // }
  // else
  if (gameState.isRoomCreator) {
    gameState.playerColor = "white";
    gameState.opponentInfo.color = "black";
    gameState.matchmaking.searching = false;
    // Send game mode to joiner
    const modeMessage = {
      type: "mode",
      mode: gameState.gameMode,
    };
    peer.write(b4a.from(JSON.stringify(modeMessage)));
  } else {
    gameState.playerColor = "black";
    gameState.opponentInfo.color = "white";
    gameState.matchmaking.searching = false;
  }

  peer.on("data", (data) => {
    try {
      const message = JSON.parse(b4a.toString(data));
      switch (message.type) {
        case "move":
          handleGameMessage(message);
          break;
        case "timeout":
          handleTimeOutMessage(message);
          break;
        case "chat":
          handleChatMessage(message);
          break;
        case "mode":
          handleModeMessage(message);
          break;
        case "restart":
          handleRestartMessage();
          break;
      }
    } catch (e) {
      debug(`Error handling message: `, "error");
    }
  });

  peer.on("error", (e) => debug(`Connection error: ${e}`, "error"));
  //startGame();
  // For room creator, game is started after mode selection
  // For joiner, game starts when they receive mode from creator
  if (gameState.isRoomCreator || gameState.gameMode) {
    startGame();
  }
});

// Add disconnection handler with debug
swarm.on("disconnection", (peer) => {
  debug(`Peer disconnected`, "warning");
  debug(`Remaining connections: ${swarm.connections.size}`, "info");

  if (gameState.matchmaking.searching) {
    debug("Disconnection during matchmaking, resuming search...", "info");
    searchForOpponent();
  }
});
// Add handler for restart message
function handleRestartMessage() {
  // Reset game state
  gameState.game = new Game();
  gameState.selectedPiece = null;
  gameState.gameStarted = true;

  // Reset timers based on game mode
  if (gameState.gameMode === "blitz") {
    gameState.timers.white = 5 * 60;
    gameState.timers.black = 5 * 60;
  } else {
    gameState.timers.white = 25 * 60;
    gameState.timers.black = 25 * 60;
  }

  // Hide any modal that might be shown
  hideResultModal();

  // Render fresh board
  renderBoard();
  updateGameStatus();

  // Start timer for white (first player)
  startTimer("white");

  // Play start sound
  playSound("gameStartSound");
  debug("Game restarted by opponent", "info");
}

// Handle receiving game mode from creator
function handleModeMessage(message) {
  gameState.gameMode = message.mode;
  debug(`Received game mode: ${message.mode}`, "info");

  // Set timer values based on received mode
  if (message.mode === "blitz") {
    gameState.timers.white = 5 * 60;
    gameState.timers.black = 5 * 60;
  } else {
    gameState.timers.white = 25 * 60;
    gameState.timers.black = 25 * 60;
  }

  // Hide loading screen and start game
  hideLoading();
  // Start the game if not already started
  if (!gameState.gameStarted) {
    startGame();
  }
}

function startGame() {
  gameState.gameStarted = true;
  gameState.game = new Game();

  showStage("game");

  debug("Starting new game", "info");
  debug(`Player color: ${gameState.playerColor}`, "info");

  const config = gameState.game.exportJson();
  debug("Initial board configuration:", "info");
  debug(JSON.stringify(config.pieces, null, 2), "info");

  updatePlayerInfo("player-info", gameState.username, gameState.playerColor);
  // TODO :Dhruv share username so they can display
  updatePlayerInfo(
    "opponent-info",
    gameState.opponentInfo.username,
    gameState.opponentInfo.color
  );

  renderBoard();
  updateGameStatus();
  startTimer("white"); // White always moves first
  playSound("gameStartSound");
  debug("Game started", "success");
}

function startTimer(color) {
  debug(`Starting timer for ${color}`, "info");

  // Don't start timer if in matchmaking or game not started
  if (gameState.matchmaking.searching) {
    debug("Timer start prevented - still in matchmaking", "warning");
    return;
  }

  if (!gameState.gameStarted) {
    debug("Timer start prevented - game not started", "warning");
    return;
  }

  // Clear any existing timer
  if (gameState.timers.activeTimer) {
    clearInterval(gameState.timers.activeTimer);
  }

  gameState.timers.lastMoveTime = Date.now();

  gameState.timers.activeTimer = setInterval(() => {
    // Decrement time
    gameState.timers[color]--;

    // Update display
    const isPlayerTimer = gameState.playerColor === color;
    const timerElement = document.getElementById(
      isPlayerTimer ? "player-timer" : "opponent-timer"
    );
    timerElement.textContent = formatTime(gameState.timers[color]);

    // Add warning class when time is low (< 30 seconds)
    if (gameState.timers[color] < 30) {
      timerElement.classList.add("low");
    }

    // Check for time out
    if (gameState.timers[color] <= 0) {
      clearInterval(gameState.timers.activeTimer);
      handleTimeout(color);
    }
  }, 1000);
}

function stopTimer() {
  if (gameState.timers.activeTimer) {
    clearInterval(gameState.timers.activeTimer);
    gameState.timers.activeTimer = null;
  }
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function handleTimeout(color) {
  const winner = color === "white" ? "Black" : "White";
  const status = document.getElementById("game-status");
  status.textContent = `Time's up! ${winner} wins!`;
  playSound("gameOverSound");
  gameState.gameStarted = false;
  stopTimer();

  // Show modal instead of alert
  const message = `<span class="winner">${winner}</span> wins by timeout!<br>
                   <span class="loser">${
                     color === "white" ? "White" : "Black"
                   }</span> ran out of time.`;
  showResultModal(message, winner.toLowerCase());

  // Notify the opponent
  const timeoutMessage = {
    type: "timeout",
    loser: color,
  };

  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(timeoutMessage)));
  }

  //setTimeout(() => alert(`Time's up! ${winner} wins!`), 100)
}

function renderBoard() {
  const chessBoard = document.getElementById("chess-board");
  chessBoard.innerHTML = "";

  const configuration = gameState.game.exportJson();
  const pieces = configuration.pieces;
  const moves = configuration.moves;
  const isBlackPlayer = gameState.playerColor === "black";

  debug("Current board configuration:", "info");
  debug(JSON.stringify(configuration, null, 2), "info");

  // Create the 8x8 grid
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement("div");

      // Get the position in chess notation (e.g., 'E2')
      const files = ["A", "B", "C", "D", "E", "F", "G", "H"];
      const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];

      // Calculate position based on player's perspective
      const displayRow = isBlackPlayer ? 7 - row : row;
      const displayCol = isBlackPlayer ? 7 - col : col;
      const position = files[displayCol] + ranks[displayRow];

      square.className = `chess-square ${
        (row + col) % 2 === 0 ? "white" : "black"
      }`;
      square.dataset.position = position;

      // Add piece if exists at this position
      if (pieces[position]) {
        debug(
          `Adding piece ${pieces[position]} at position ${position}`,
          "info"
        );
        const img = document.createElement("img");
        img.src = `chesspieces/${getPieceImage(pieces[position])}`;
        img.className = "chess-piece";
        img.draggable = true;
        square.appendChild(img);
      }

      // Highlight selected piece
      if (gameState.selectedPiece === position) {
        square.classList.add("selected-piece");
      }

      // Highlight possible moves for selected piece
      if (
        gameState.selectedPiece &&
        moves[gameState.selectedPiece] &&
        moves[gameState.selectedPiece].includes(position)
      ) {
        square.classList.add("possible-move");

        // Add move indicator dot
        const moveIndicator = document.createElement("div");
        moveIndicator.className = "move-indicator";
        square.appendChild(moveIndicator);
      }

      chessBoard.appendChild(square);
    }
  }
}

function getPieceImage(piece) {
  debug(`Getting image for piece: ${piece}`, "info");

  // Map piece notation to image filename
  const pieceMap = {
    K: "wK.png",
    Q: "wQ.png",
    R: "wR.png",
    B: "wB.png",
    N: "wN.png",
    P: "wP.png", // White pieces
    k: "bK.png",
    q: "bQ.png",
    r: "bR.png",
    b: "bB.png",
    n: "bN.png",
    p: "bP.png", // Black pieces
  };

  const imageName = pieceMap[piece];
  if (!imageName) {
    debug(`Warning: Unknown piece type ${piece}`, "error");
    return "unknown.png";
  }

  debug(`Using image: ${imageName}`, "info");
  return imageName;
}

function handleBoardClick(event) {
  const square = event.target.closest(".chess-square");
  if (!square) return;

  const position = square.dataset.position;
  const configuration = gameState.game.exportJson();

  // Check if it's player's turn
  const isPlayerTurn =
    configuration.turn.toLowerCase() === gameState.playerColor;
  if (!isPlayerTurn) {
    debug(`Not your turn! Current turn: ${configuration.turn}`, "error");
    return;
  }

  const piece = configuration.pieces[position];

  // If clicking on a possible move position for the selected piece
  if (
    gameState.selectedPiece &&
    configuration.moves[gameState.selectedPiece] &&
    configuration.moves[gameState.selectedPiece].includes(position)
  ) {
    // Make the move
    const move = gameState.game.move(gameState.selectedPiece, position);
    broadcastMove(gameState.selectedPiece, position);
    gameState.selectedPiece = null;
    renderBoard();
    updateGameStatus();
    playSound("moveSound");

    // Switch timer
    const currentColor = configuration.turn === "WHITE" ? "white" : "black";
    const nextColor = currentColor === "white" ? "black" : "white";
    stopTimer();
    startTimer(nextColor);

    return;
  }

  // If clicking on a piece
  if (piece) {
    const isPieceWhite = piece === piece.toUpperCase();
    const isPlayerWhite = gameState.playerColor === "white";

    // If trying to select opponent's piece, return
    if (isPieceWhite !== isPlayerWhite) {
      debug(`Cannot move opponent's pieces!`, "error");
      return;
    }

    // Select the piece and show possible moves
    gameState.selectedPiece = position;
    renderBoard();
    return;
  }

  // If clicking on an empty square (not a valid move)
  gameState.selectedPiece = null;
  renderBoard();
}

function updateGameStatus() {
  const status = document.getElementById("game-status");
  // Handle matchmaking status
  if (gameState.matchmaking.searching) {
    debug("Updating status for matchmaking", "info");
    if (swarm.connections.size > 0) {
      status.textContent = "Opponent found! Starting game...";
      debug("Status updated: Opponent found", "success");
    } else {
      status.textContent = "Searching for opponent...";
      debug("Status updated: Searching", "info");
    }
    return;
  }

  // Handle game not started
  if (!gameState.gameStarted) {
    if (swarm.connections.size === 0) {
      status.textContent = "Waiting for opponent...";
      debug("Status updated: Waiting for opponent", "info");
    } else {
      status.textContent = "Opponent connected. Game starting...";
      debug("Status updated: Game starting", "success");
    }
    return;
  }

  const configuration = gameState.game.exportJson();

  if (!gameState.gameStarted) {
    status.textContent = "Waiting for opponent...";
    return;
  }

  const isYourTurn = configuration.turn.toLowerCase() === gameState.playerColor;
  status.textContent = `${configuration.turn}'s turn${
    isYourTurn ? " (Your turn)" : ""
  }`;

  if (configuration.check) {
    status.textContent += " - CHECK!";
    playSound("checkSound");
  }

  if (configuration.checkMate) {
    status.textContent += " - CHECKMATE!";
    playSound("gameOverSound");
    //const winner = configuration.turn === "WHITE" ? "Black" : "White";
    //setTimeout(() => alert(`Checkmate! ${winner} wins!`), 100);

    const winner = configuration.turn === "WHITE" ? "Black" : "White";
    const loser = configuration.turn === "WHITE" ? "White" : "Black";

    // Show modal instead of alert
    const message = `<span class="winner">${winner}</span> wins by checkmate!<br>
                     <span class="loser">${loser}</span> has been checkmated.`;
    showResultModal(message, winner.toLowerCase());
  }
}

function broadcastMove(from, to) {
  const message = {
    type: "move",
    from,
    to,
  };

  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(message)));
  }
}

function handleGameMessage(message) {
  if (message.type === "move") {
    gameState.game.move(message.from, message.to);
    renderBoard();
    updateGameStatus();
    playSound("moveSound");

    // Switch timer
    const configuration = gameState.game.exportJson();
    const currentColor = configuration.turn === "WHITE" ? "white" : "black";
    stopTimer();
    startTimer(currentColor);
  }
}

function handleTimeOutMessage(message) {
  if (message.type === "timeout") {
    // Handle timeout notification from opponent
    const winner = message.loser === "white" ? "Black" : "White";
    const status = document.getElementById("game-status");
    status.textContent = `Time's up! ${winner} wins!`;
    playSound("gameOverSound");
    gameState.gameStarted = false;
    stopTimer();

    // Show modal instead of alert
    const message = `<span class="winner">${winner}</span> wins by timeout!<br>
                     <span class="loser">${
                       message.loser === "white" ? "White" : "Black"
                     }</span> ran out of time.`;
    showResultModal(message, winner.toLowerCase());
  }
}

// Chat functionality
function sendMessage(e) {
  e.preventDefault();
  const messageInput = document.querySelector("#message");
  const text = messageInput.value.trim();

  if (!text) return;

  const message = {
    type: "chat",
    username: gameState.username,
    text: text,
  };

  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(message)));
  }

  onMessageAdded(gameState.username, text);
  messageInput.value = "";
}

function onMessageAdded(username, text) {
  const $div = document.createElement("div");
  $div.className = `message ${
    username === gameState.username ? "sent" : "received"
  }`;

  const messageContent = document.createElement("span");
  messageContent.textContent = text;
  messageContent.style.color = "#000000";

  if (username !== gameState.username) {
    const usernameLabel = document.createElement("div");
    usernameLabel.className = "message-username";
    usernameLabel.textContent = username;
    usernameLabel.style.color = "#667781";
    usernameLabel.style.fontSize = "12px";
    usernameLabel.style.marginBottom = "2px";
    $div.appendChild(usernameLabel);
  }

  const timestamp = document.createElement("span");
  timestamp.className = "message-time";
  timestamp.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  timestamp.style.fontSize = "11px";
  timestamp.style.color = "#667781";
  timestamp.style.marginLeft = "8px";
  timestamp.style.float = "right";

  $div.appendChild(messageContent);
  $div.appendChild(timestamp);

  const messages = document.querySelector("#messages");
  messages.appendChild($div);
  messages.scrollTop = messages.scrollHeight;
}

async function joinSwarm(topicBuffer) {
  showLoading("Connecting to game network...");

  try {
    const discovery = swarm.join(topicBuffer, { client: true, server: true });
    await discovery.flushed();
    hideLoading();

    if (gameState.isRoomCreator) {
      document.getElementById("loading-text").textContent =
        "Waiting for opponent...";
    }
  } catch (err) {
    debug(`Failed to join swarm: ${err.message}`, "error");
    hideLoading();
  }
}

function handleChatMessage(message) {
  const { username, text } = message;
  onMessageAdded(username, text);
}

// Loading overlay
function showLoading(text = "Loading...") {
  document.getElementById("loading").classList.remove("hidden");
  document.getElementById("loading-text").textContent = text;
}

function hideLoading() {
  document.getElementById("loading").classList.add("hidden");
}

// Sound functions
function playSound(soundId) {
  const sound = document.getElementById(soundId);
  if (sound) {
    sound.currentTime = 0;
    sound.play().catch((error) => console.log("Error playing sound:", error));
  }
}

function updatePlayerInfo(elementId, username, color) {
  const element = document.getElementById(elementId);
  element.querySelector(".username").textContent = username;
  element.querySelector(".color").textContent = `Playing as ${color}`;
}

// Show modal with game result
function showResultModal(message, winnerColor) {
  const modal = document.getElementById("result-modal");
  const modalMessage = document.getElementById("modal-message");

  // Set the message
  modalMessage.innerHTML = message;

  // Show the modal
  modal.classList.remove("hidden");
  modal.classList.add("visible");

  // Setup restart button
  const restartButton = document.getElementById("restart-game");
  restartButton.addEventListener("click", restartGame, { once: true });
}

// Hide the modal
function hideResultModal() {
  const modal = document.getElementById("result-modal");
  modal.classList.remove("visible");

  // Use a slight delay to allow for the fade-out animation
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}

// Restart the game
function restartGame() {
  // Hide the modal
  hideResultModal();

  // Reset game state
  gameState.game = new Game();
  gameState.selectedPiece = null;
  gameState.gameStarted = true;

  // Reset timers based on selected game mode
  if (gameState.gameMode === "blitz") {
    gameState.timers.white = 5 * 60;
    gameState.timers.black = 5 * 60;
  } else {
    gameState.timers.white = 25 * 60;
    gameState.timers.black = 25 * 60;
  }

  // Broadcast restart to opponent
  broadcastRestart();

  // Render fresh board
  renderBoard();
  updateGameStatus();

  // Start timer for white (first player)
  startTimer("white");

  // Play start sound
  playSound("gameStartSound");
  debug("Game restarted", "success");
}

// Add this function to broadcast restart
function broadcastRestart() {
  const restartMessage = {
    type: "restart",
  };

  const peers = [...swarm.connections];
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(restartMessage)));
  }
}
