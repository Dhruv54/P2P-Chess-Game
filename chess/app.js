/**
 * P2P Chess Game Implementation with Multi-stage Flow
 */

/** @typedef {import('pear-interface')} */

/* global Pear */
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
const { teardown, updates } = Pear

// Initialize P2P networking
const swarm = new Hyperswarm()

// Game state variables
const gameState = {
  stage: 'room-selection',
  username: null,
  playerColor: null,
  opponentInfo: {
    username: null,
    color: null
  },
  board: initializeBoard(),
  currentTurn: 'white',
  gameStarted: false,
  roomCode: null,
  isRoomCreator: false,
  isCheck: false
}

let selectedSquare = null
let draggedPiece = null
let draggedPieceElement = null

// Cleanup handlers
teardown(() => swarm.destroy())
updates(() => Pear.reload())

/**
 * Debug utility to display messages in the debug panel
 * @param {string} message - Message to display
 * @param {string} type - Message type ('info', 'error', 'success')
 */
function debug(message, type = 'info') {
  const debugPanel = document.getElementById('debug-panel')
  if (!debugPanel) return // Early return if debug panel doesn't exist

  const entry = document.createElement('div')
  entry.className = `debug-entry ${type}`
  entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`
  debugPanel.appendChild(entry)
  debugPanel.scrollTop = debugPanel.scrollHeight
  console.log(`[${type}] ${message}`)

  // Limit debug messages to last 50
  while (debugPanel.children.length > 50) {
    debugPanel.removeChild(debugPanel.firstChild)
  }
}

// Initialize UI when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  try {
    debug('Initializing game UI...')
    initializeUI()
    setupEventListeners()
    initializeTheme()
    debug('Game UI initialized successfully', 'success')
  } catch (error) {
    debug(`Error initializing game UI: ${error.message}`, 'error')
    console.error('Initialization error:', error)
  }
})

// Theme toggle functionality
function initializeTheme() {
  const theme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
}

// Stage navigation
function showStage(stageName) {
  try {
    debug(`Attempting to show stage: ${stageName}`)

    // Hide all stages first
    const stages = document.querySelectorAll('.stage')
    if (!stages.length) {
      throw new Error('No stage elements found')
    }

    stages.forEach(stage => {
      stage.classList.add('hidden')
      debug(`Hidden stage: ${stage.id}`)
    })

    // Show the requested stage
    const targetStage = document.getElementById(`stage-${stageName}`)
    if (!targetStage) {
      throw new Error(`Stage not found: ${stageName}`)
    }

    targetStage.classList.remove('hidden')
    gameState.stage = stageName
    debug(`Successfully switched to stage: ${stageName}`, 'success')

  } catch (error) {
    debug(`Error showing stage ${stageName}: ${error.message}`, 'error')
    console.error('Stage navigation error:', error)
  }
}

function initializeUI() {
  playSound('gameBackgroundSound');
  // Ensure all required elements exist
  const requiredElements = [
    'debug-panel',
    'stage-room-selection',
    'stage-room-setup',
    'stage-game',
    'loading'
  ]

  const missingElements = requiredElements.filter(id => !document.getElementById(id))
  if (missingElements.length) {
    throw new Error(`Missing required elements: ${missingElements.join(', ')}`)
  }

  // Show initial stage
  showStage('room-selection')
}

function setupEventListeners() {
  try {
    // Stage 1: Room Selection
    const createRoomBtn = document.getElementById('create-room-btn')
    const joinRoomBtn = document.getElementById('join-room-btn')

    if (!createRoomBtn || !joinRoomBtn) {
      throw new Error('Room selection buttons not found')
    }

    createRoomBtn.addEventListener('click', () => {
      showStage('room-setup')
      document.getElementById('create-room-form').classList.remove('hidden')
      document.getElementById('join-room-form').classList.add('hidden')
    })

    joinRoomBtn.addEventListener('click', () => {
      showStage('room-setup')
      document.getElementById('join-room-form').classList.remove('hidden')
      document.getElementById('create-room-form').classList.add('hidden')
    })

    // Stage 2: Room Setup
    setupRoomEventListeners()

    // Stage 4: Game Interface
    setupGameInterfaceListeners()

    debug('Event listeners setup completed', 'success')
  } catch (error) {
    debug(`Error setting up event listeners: ${error.message}`, 'error')
    console.error('Event listener setup error:', error)
  }
}

function setupRoomEventListeners() {
  const createRoomSubmit = document.getElementById('create-room-submit')
  const joinRoomSubmit = document.getElementById('join-room-submit')
  const copyRoomCode = document.getElementById('copy-room-code')

  createRoomSubmit.addEventListener('click', async (e) => {
    e.preventDefault()
    const username = document.getElementById('create-username').value.trim()
    if (!username) {
      debug('Username is required', 'error')
      return
    }

    gameState.username = username
    gameState.isRoomCreator = true

    // Generate room code
    const topicBuffer = crypto.randomBytes(32)
    gameState.roomCode = b4a.toString(topicBuffer, 'hex')

    // Show room code and waiting message
    document.getElementById('room-code-display').value = gameState.roomCode
    document.getElementById('room-code-display-container').classList.remove('hidden')
    createRoomSubmit.classList.add('hidden')

    // Join swarm and wait for opponent
    await joinSwarm(topicBuffer)
  })

  joinRoomSubmit.addEventListener('click', async (e) => {
    e.preventDefault()
    const username = document.getElementById('join-username').value.trim()
    const roomCode = document.getElementById('room-code-input').value.trim()

    if (!username || !roomCode) {
      debug('Username and room code are required', 'error')
      return
    }

    gameState.username = username
    gameState.roomCode = roomCode

    try {
      const topicBuffer = b4a.from(roomCode, 'hex')
      await joinSwarm(topicBuffer)
    } catch (err) {
      debug('Invalid room code', 'error')
    }
  })

  copyRoomCode.addEventListener('click', async () => {
    const roomCode = document.getElementById('room-code-display').value
    await navigator.clipboard.writeText(roomCode)
    debug('Room code copied to clipboard', 'success')
  })
}

function setupGameInterfaceListeners() {
  const messageForm = document.getElementById('message-form')
  messageForm.addEventListener('submit', sendMessage)
}

// P2P Communication
swarm.on('connection', (peer) => {
  // Only allow 2 peers in a room
  if (swarm.connections.size > 1) {
    peer.destroy()
    return
  }

  debug('Peer connected', 'success')

  // Automatically start game when peer connects
  if (gameState.isRoomCreator) {
    gameState.playerColor = 'white'
    gameState.opponentInfo.color = 'black'
  } else {
    gameState.playerColor = 'black'
    gameState.opponentInfo.color = 'white'
  }
  startGame()

  peer.on('data', data => {
    try {
      const message = JSON.parse(b4a.toString(data))

      switch (message.type) {
        case 'move':
          handleGameMessage(message)
          break
        case 'chat':
          handleChatMessage(message)
          break
      }
    } catch (e) {
      debug(`Error handling message: ${e.message}`, 'error')
    }
  })

  peer.on('error', e => debug(`Connection error: ${e}`, 'error'))
})

swarm.on('update', () => {
  document.querySelector('#peers-count').textContent = swarm.connections.size

  if (swarm.connections.size === 1) {
    // When opponent connects, start the game immediately
    if (gameState.isRoomCreator) {
      gameState.playerColor = 'white'
      gameState.opponentInfo.color = 'black'
    } else {
      gameState.playerColor = 'black'
      gameState.opponentInfo.color = 'white'
    }
    startGame()
  }
})

function startGame() {
  gameState.gameStarted = true
  showStage('game')

  // Update player info displays
  updatePlayerInfo('player-info', gameState.username, gameState.playerColor)
  updatePlayerInfo('opponent-info', gameState.opponentInfo.username, gameState.opponentInfo.color)
  createChessBoard()
  updateGameStatus();
  playSound('gameStartSound');
  debug('Game started', 'success');
}

// Sound functions
function playSound(soundId) {
  const sound = document.getElementById(soundId);
  if (sound) {
    sound.currentTime = 0; // Reset the audio to start
    sound.play().catch(error => console.log('Error playing sound:', error));
  }
}

function updatePlayerInfo(elementId, username, color) {
  const element = document.getElementById(elementId)
  element.querySelector('.username').textContent = username
  element.querySelector('.color').textContent = `Playing as ${color}`
}

// Chat functionality
function sendMessage(e) {
  e.preventDefault()
  const messageInput = document.querySelector('#message')
  const text = messageInput.value.trim()

  if (!text) return

  const message = {
    type: 'chat',
    username: gameState.username,
    text: text
  }

  // Send to all peers
  const peers = [...swarm.connections]
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(message)))
  }

  // Add to local chat
  onMessageAdded(gameState.username, text)
  messageInput.value = ''
}

function onMessageAdded(username, text) {
  const $div = document.createElement('div')
  $div.className = `message ${username === gameState.username ? 'sent' : 'received'}`

  // Create message content
  const messageContent = document.createElement('span')
  messageContent.textContent = text
  messageContent.style.color = '#000000'

  // Create username label if it's a received message
  if (username !== gameState.username) {
    const usernameLabel = document.createElement('div')
    usernameLabel.className = 'message-username'
    usernameLabel.textContent = username
    usernameLabel.style.color = '#667781'
    usernameLabel.style.fontSize = '12px'
    usernameLabel.style.marginBottom = '2px'
    $div.appendChild(usernameLabel)
  }

  // Add timestamp
  const timestamp = document.createElement('span')
  timestamp.className = 'message-time'
  timestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  timestamp.style.fontSize = '11px'
  timestamp.style.color = '#667781'
  timestamp.style.marginLeft = '8px'
  timestamp.style.float = 'right'

  $div.appendChild(messageContent)
  $div.appendChild(timestamp)

  const messages = document.querySelector('#messages')
  messages.appendChild($div)

  // Auto-scroll to bottom
  messages.scrollTop = messages.scrollHeight
}

// Loading overlay
function showLoading(text = 'Loading...') {
  document.getElementById('loading').classList.remove('hidden')
  document.getElementById('loading-text').textContent = text
}

function hideLoading() {
  document.getElementById('loading').classList.add('hidden')
}

// Copy room code functionality
window.copyRoomCode = async function () {
  const roomCode = document.getElementById('room-code-display').value
  await navigator.clipboard.writeText(roomCode)

  const button = document.querySelector('.copy-button')
  const tooltip = document.createElement('div')
  tooltip.className = 'tooltip'
  tooltip.textContent = 'Copied!'

  button.appendChild(tooltip)
  setTimeout(() => tooltip.classList.add('visible'), 0)
  setTimeout(() => {
    tooltip.classList.remove('visible')
    setTimeout(() => tooltip.remove(), 200)
  }, 1500)
}

// Chess piece image mappings for both colors
const PIECES = {
  white: {
    king: 'wK.png',
    queen: 'wQ.png',
    rook: 'wR.png',
    bishop: 'wB.png',
    knight: 'wN.png',
    pawn: 'wP.png'
  },
  black: {
    king: 'bK.png',
    queen: 'bQ.png',
    rook: 'bR.png',
    bishop: 'bB.png',
    knight: 'bN.png',
    pawn: 'bP.png'
  }
}

/**
 * Initialize the chess board with pieces in their starting positions
 * Returns an 8x8 array representing the board state
 */
function initializeBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(null))

  // Place pawns for both colors
  for (let i = 0; i < 8; i++) {
    board[1][i] = { type: 'pawn', color: 'black' }
    board[6][i] = { type: 'pawn', color: 'white' }
  }

  // Place the back row pieces for both colors
  const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']
  for (let i = 0; i < 8; i++) {
    board[0][i] = { type: backRow[i], color: 'black' }
    board[7][i] = { type: backRow[i], color: 'white' }
  }

  return board
}

/**
 * Creates and renders the chess board UI
 * Handles piece placement, drag-and-drop, and click events
 */
function createChessBoard() {
  const chessBoard = document.querySelector('#chess-board')
  chessBoard.innerHTML = ''
  debug(`Creating board. Player color: ${gameState.playerColor}`)

  gameState.gameStarted = true
  const isBlack = gameState.playerColor === 'black'

  // Create the 8x8 grid of squares
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement('div')
      // Adjust coordinates based on player's color perspective
      const actualRow = isBlack ? 7 - row : row
      const actualCol = isBlack ? 7 - col : col

      square.className = `chess-square ${(row + col) % 2 === 0 ? 'white' : 'black'}`
      square.dataset.row = actualRow.toString()
      square.dataset.col = actualCol.toString()

      // Add chess pieces to their squares
      const piece = gameState.board[actualRow][actualCol]
      if (piece) {
        const img = document.createElement('img')
        img.src = `chesspieces/${PIECES[piece.color][piece.type]}`
        img.className = 'chess-piece'
        img.draggable = true
        img.dataset.row = actualRow.toString()
        img.dataset.col = actualCol.toString()

        // Setup drag and drop handlers for pieces
        img.addEventListener('dragstart', function (e) {
          debug(`Dragstart triggered on ${piece.color} ${piece.type} at ${actualRow},${actualCol}`)

          // Check game state
          if (!gameState.gameStarted) {
            debug('Cannot drag: Game not started', 'error')
            e.preventDefault()
            return false
          }

          // Check turn
          if (gameState.currentTurn !== gameState.playerColor) {
            debug(`Cannot drag: Not your turn. Current turn: ${gameState.currentTurn}, Your color: ${gameState.playerColor}`, 'error')
            e.preventDefault()
            return false
          }

          // Check piece color
          if (piece.color !== gameState.playerColor) {
            debug(`Cannot drag: Not your piece. Piece color: ${piece.color}, Your color: ${gameState.playerColor}`, 'error')
            e.preventDefault()
            return false
          }

          draggedPiece = piece
          draggedPieceElement = this
          this.classList.add('dragging')
          debug(`Drag started successfully`, 'success')

          try {
            e.dataTransfer.setData('text/plain', `${actualRow},${actualCol}`)
            debug('Set drag data successfully', 'success')
          } catch (err) {
            debug(`Error setting drag data: ${err.message}`, 'error')
          }

          // Highlight valid moves for the dragged piece
          const validSquares = []
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
              if (isValidMove(actualRow, actualCol, r, c)) {
                validSquares.push([r, c])
              }
            }
          }
          debug(`Found ${validSquares.length} valid moves`)

          // Visual feedback for valid moves
          validSquares.forEach(([r, c]) => {
            const visualRow = isBlack ? 7 - r : r
            const visualCol = isBlack ? 7 - c : c
            const square = document.querySelector(`.chess-square[data-row="${r}"][data-col="${c}"]`)
            if (square) {
              square.classList.add('valid-drop')
              debug(`Highlighted square ${r},${c} as valid move`)
            }
          })
        })

        square.appendChild(img)
      }

      // Handle piece drops on squares
      square.addEventListener('dragover', function (e) {
        e.preventDefault() // Allow drop
      })

      square.addEventListener('drop', function (e) {
        e.preventDefault()
        debug(`Drop event triggered on square ${actualRow},${actualCol}`)

        if (!draggedPieceElement) {
          debug('Drop failed: No piece being dragged', 'error')
          return
        }

        try {
          const [sourceRow, sourceCol] = e.dataTransfer.getData('text/plain').split(',').map(Number)
          debug(`Attempting move from ${sourceRow},${sourceCol} to ${actualRow},${actualCol}`)

          if (isValidMove(sourceRow, sourceCol, actualRow, actualCol)) {
            debug('Move is valid, executing...', 'success')
            makeMove(sourceRow, sourceCol, actualRow, actualCol)
            broadcastMove(sourceRow, sourceCol, actualRow, actualCol)
          } else {
            debug('Invalid move', 'error')
          }
        } catch (err) {
          debug(`Error during drop: ${err.message}`, 'error')
        }

        // Cleanup after drop
        draggedPieceElement.classList.remove('dragging')
        draggedPieceElement = null
        draggedPiece = null
        document.querySelectorAll('.chess-square').forEach(sq => sq.classList.remove('valid-drop'))
        debug('Drag and drop cleanup completed')
      })

      // Handle click-based moves
      square.addEventListener('click', () => handleSquareClick(actualRow, actualCol))
      chessBoard.appendChild(square)
    }
  }

  // Global dragend handler for cleanup
  document.addEventListener('dragend', function () {
    debug('Global dragend event triggered')
    if (draggedPieceElement) {
      draggedPieceElement.classList.remove('dragging')
      draggedPieceElement = null
      draggedPiece = null
      document.querySelectorAll('.chess-square').forEach(sq => sq.classList.remove('valid-drop'))
      debug('Cleaned up failed drag')
    }
  })

  updateGameStatus()
}

/**
 * Handles clicking on chess squares for piece movement
 * Supports selecting pieces and making moves
 */
function handleSquareClick(row, col) {
  if (!gameState.gameStarted || gameState.currentTurn !== gameState.playerColor) return

  const clickedPiece = gameState.board[row][col]

  if (selectedSquare) {
    if (clickedPiece && clickedPiece.color === gameState.playerColor) {
      // Select new piece
      selectSquare(row, col)
    } else {
      // Try to move
      const [selectedRow, selectedCol] = selectedSquare
      if (isValidMove(selectedRow, selectedCol, row, col)) {
        makeMove(selectedRow, selectedCol, row, col)
        broadcastMove(selectedRow, selectedCol, row, col)
      }
    }
  } else if (clickedPiece && clickedPiece.color === gameState.playerColor) {
    selectSquare(row, col)
  }
}

/**
 * Handles piece selection and highlights valid moves
 */
function selectSquare(row, col) {
  clearHighlights()

  selectedSquare = [row, col]
  const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`)
  square.classList.add('selected')

  // Find and highlight valid moves
  const validSquares = []
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isValidMove(row, col, r, c)) {
        validSquares.push([r, c])
      }
    }
  }

  validSquares.forEach(([r, c]) => {
    const square = document.querySelector(`.chess-square[data-row="${r}"][data-col="${c}"]`)
    if (square) square.classList.add('valid-move')
  })
}

/**
 * Removes all visual highlights from the board
 */
function clearHighlights() {
  document.querySelectorAll('.chess-square').forEach(square => {
    square.classList.remove('selected', 'valid-move', 'valid-drop', 'invalid-drop')
  })
  selectedSquare = null
}

/**
 * Validates if a move is legal according to chess rules
 * Implements basic movement patterns for each piece type
 */
function isValidMove(fromRow, fromCol, toRow, toCol) {
  const piece = gameState.board[fromRow][fromCol]
  const targetSquare = gameState.board[toRow][toCol]

  // Basic validation
  if (fromRow === toRow && fromCol === toCol) return false
  if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return false
  if (targetSquare && targetSquare.color === piece.color) return false

  // Piece-specific movement rules
  switch (piece.type) {
    case 'pawn':
      const direction = piece.color === 'white' ? -1 : 1
      const startRow = piece.color === 'white' ? 6 : 1

      // Forward movement
      if (fromCol === toCol && !targetSquare) {
        if (toRow === fromRow + direction) return true
        if (fromRow === startRow && toRow === fromRow + 2 * direction && !gameState.board[fromRow + direction][fromCol]) return true
      }

      // Diagonal capture
      if (Math.abs(fromCol - toCol) === 1 && toRow === fromRow + direction) {
        if (targetSquare) return true
      }
      return false

    case 'knight':
      return (Math.abs(fromRow - toRow) === 2 && Math.abs(fromCol - toCol) === 1) ||
        (Math.abs(fromRow - toRow) === 1 && Math.abs(fromCol - toCol) === 2)

    case 'bishop':
      return Math.abs(fromRow - toRow) === Math.abs(fromCol - toCol)

    case 'rook':
      return fromRow === toRow || fromCol === toCol

    case 'queen':
      return fromRow === toRow || fromCol === toCol ||
        Math.abs(fromRow - toRow) === Math.abs(fromCol - toCol)

    case 'king':
      return Math.abs(fromRow - toRow) <= 1 && Math.abs(fromCol - toCol) <= 1

    default:
      return false
  }
}

/**
 * Executes a move on the board and updates the game state
 */
function makeMove(fromRow, fromCol, toRow, toCol) {
  const piece = gameState.board[fromRow][fromCol]
  gameState.board[toRow][toCol] = piece
  gameState.board[fromRow][fromCol] = null
  gameState.currentTurn = gameState.currentTurn === 'white' ? 'black' : 'white'

  clearHighlights()
  createChessBoard()
  updateGameStatus()

  // Play move sound
  playSound('moveSound');

  // Check if the move puts the opponent in check
  if (isCheck(gameState.currentTurn)) {
    gameState.isCheck = true;
    playSound('checkSound');

    // Check if it's checkmate
    if (isCheckmate(gameState.currentTurn)) {
      playSound('gameOverSound');
      const winner = gameState.currentTurn === 'white' ? 'Black' : 'White';
      setTimeout(() => alert(`Checkmate! ${winner} wins!`), 100);
    }
  } else {
    gameState.isCheck = false;
  }

  updateGameStatus();
}

/**
 * Updates the game status display
 */
function updateGameStatus() {
  const status = document.querySelector('#game-status')
  if (!gameState.gameStarted) {
    status.textContent = 'Waiting for opponent...'
  } else {
    const isYourTurn = gameState.currentTurn === gameState.playerColor
    status.textContent = `${gameState.currentTurn.charAt(0).toUpperCase() + gameState.currentTurn.slice(1)}'s turn${isYourTurn ? ' (Your turn)' : ''}`
  }
}

/**
 * Send move to opponent
 */
function broadcastMove(fromRow, fromCol, toRow, toCol) {
  const message = {
    type: 'move',
    fromRow,
    fromCol,
    toRow,
    toCol
  }

  const peers = [...swarm.connections]
  for (const peer of peers) {
    peer.write(b4a.from(JSON.stringify(message)))
  }
}

/**
 * Handle incoming game messages from opponent
 */
function handleGameMessage(message) {
  switch (message.type) {
    case 'move':
      if (gameState.currentTurn !== gameState.playerColor) {
        makeMove(message.fromRow, message.fromCol, message.toRow, message.toCol)
      }
      break
  }
}

async function joinSwarm(topicBuffer) {
  showLoading('Connecting to game network...')

  try {
    const discovery = swarm.join(topicBuffer, { client: true, server: true })
    await discovery.flushed()
    hideLoading()

    if (gameState.isRoomCreator) {
      document.getElementById('loading-text').textContent = 'Waiting for opponent...'
    }
  } catch (err) {
    debug(`Failed to join swarm: ${err.message}`, 'error')
    hideLoading()
  }
}

function handleChatMessage(message) {
  const { username, text } = message
  onMessageAdded(username, text)
}

// Add these new functions for check and checkmate detection
function isCheck(color) {
  // Simplified check detection - you may want to implement more sophisticated logic
  const kingPos = findKing(color);
  if (!kingPos) return false;

  // Check if any opponent piece can capture the king
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = gameState.board[row][col];
      if (piece && piece.color !== color) {
        if (isValidMove(row, col, kingPos.row, kingPos.col)) {
          return true;
        }
      }
    }
  }
  return false;
}

function findKing(color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = gameState.board[row][col];
      if (piece && piece.type === 'king' && piece.color === color) {
        return { row, col };
      }
    }
  }
  return null;
}

function isCheckmate(color) {
  // Simplified checkmate detection - you may want to implement more sophisticated logic
  if (!isCheck(color)) return false;

  // Try all possible moves for all pieces of the given color
  for (let fromRow = 0; fromRow < 8; fromRow++) {
    for (let fromCol = 0; fromCol < 8; fromCol++) {
      const piece = gameState.board[fromRow][fromCol];
      if (piece && piece.color === color) {
        for (let toRow = 0; toRow < 8; toRow++) {
          for (let toCol = 0; toCol < 8; toCol++) {
            if (isValidMove(fromRow, fromCol, toRow, toCol)) {
              // Try the move
              const tempPiece = gameState.board[toRow][toCol];
              gameState.board[toRow][toCol] = piece;
              gameState.board[fromRow][fromCol] = null;

              // Check if the move gets out of check
              const stillInCheck = isCheck(color);

              // Undo the move
              gameState.board[fromRow][fromCol] = piece;
              gameState.board[toRow][toCol] = tempPiece;

              if (!stillInCheck) return false;
            }
          }
        }
      }
    }
  }
  return true;
}