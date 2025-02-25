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
  isCheck: false,
  moveHistory: [],
  halfMoveClock: 0,
  castlingRights: {
    white: { kingSide: true, queenSide: true },
    black: { kingSide: true, queenSide: true }
  },
  enPassantTarget: null,
  positionHistory: [],
  pendingPromotion: null
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
    // Only allow selecting pieces that can make valid moves when in check
    if (gameState.isCheck) {
      let hasValidMove = false
      for (let toRow = 0; toRow < 8; toRow++) {
        for (let toCol = 0; toCol < 8; toCol++) {
          if (isValidMove(row, col, toRow, toCol)) {
            hasValidMove = true
            break
          }
        }
        if (hasValidMove) break
      }
      if (hasValidMove) {
        selectSquare(row, col)
      }
    } else {
      selectSquare(row, col)
    }
  }
}

/**
 * Validates if a move is legal according to chess rules
 */
function isValidMove(fromRow, fromCol, toRow, toCol) {
  const piece = gameState.board[fromRow][fromCol]
  const targetSquare = gameState.board[toRow][toCol]

  // Basic validation
  if (fromRow === toRow && fromCol === toCol) return false
  if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return false
  if (targetSquare && targetSquare.color === piece.color) return false

  // Check if this move would put or leave own king in check
  const tempPiece = gameState.board[toRow][toCol]
  gameState.board[toRow][toCol] = piece
  gameState.board[fromRow][fromCol] = null
  const wouldBeInCheck = isKingAttacked(piece.color)
  gameState.board[fromRow][fromCol] = piece
  gameState.board[toRow][toCol] = tempPiece
  if (wouldBeInCheck) return false

  // Piece-specific movement rules
  switch (piece.type) {
    case 'pawn':
      const direction = piece.color === 'white' ? -1 : 1
      const startRow = piece.color === 'white' ? 6 : 1

      // Forward movement
      if (fromCol === toCol && !targetSquare) {
        // One square forward
        if (toRow === fromRow + direction) return true
        
        // Two squares forward from start
        if (fromRow === startRow && 
            toRow === fromRow + 2 * direction && 
            !gameState.board[fromRow + direction][fromCol]) {
          return true
        }
      }

      // Diagonal capture
      if (Math.abs(fromCol - toCol) === 1 && toRow === fromRow + direction) {
        // Normal capture
        if (targetSquare) return true
        
        // En passant
        if (gameState.enPassantTarget && 
            toRow === gameState.enPassantTarget[0] && 
            toCol === gameState.enPassantTarget[1]) {
          return true
        }
      }
      return false

    case 'knight':
      return (Math.abs(fromRow - toRow) === 2 && Math.abs(fromCol - toCol) === 1) ||
             (Math.abs(fromRow - toRow) === 1 && Math.abs(fromCol - toCol) === 2)

    case 'bishop':
      if (Math.abs(fromRow - toRow) !== Math.abs(fromCol - toCol)) return false
      return !isPieceBetween(fromRow, fromCol, toRow, toCol)

    case 'rook':
      if (fromRow !== toRow && fromCol !== toCol) return false
      return !isPieceBetween(fromRow, fromCol, toRow, toCol)

    case 'queen':
      if (fromRow !== toRow && fromCol !== toCol &&
          Math.abs(fromRow - toRow) !== Math.abs(fromCol - toCol)) return false
      return !isPieceBetween(fromRow, fromCol, toRow, toCol)

    case 'king': {
      // Normal move
      if (Math.abs(fromRow - toRow) <= 1 && Math.abs(fromCol - toCol) <= 1) {
        return !isSquareAttacked(toRow, toCol, piece.color)
      }

      // Castling
      if (fromRow === toRow && Math.abs(fromCol - toCol) === 2) {
        if (gameState.isCheck) return false
        
        const castlingRights = gameState.castlingRights[piece.color]
        const isKingSide = toCol > fromCol

        // Verify castling rights
        if (!(isKingSide ? castlingRights.kingSide : castlingRights.queenSide)) {
          return false
        }

        // Check path is clear
        const rookCol = isKingSide ? 7 : 0
        if (isPieceBetween(fromRow, fromCol, fromRow, rookCol)) {
          return false
        }

        // Check if path is under attack
        const pathCol = isKingSide ? [fromCol + 1, fromCol + 2] : [fromCol - 1, fromCol - 2]
        for (const col of pathCol) {
          if (isSquareAttacked(fromRow, col, piece.color)) {
            return false
          }
        }

        return true
      }
      return false
    }

    default:
      return false
  }
}

function isKingAttacked(color) {
  const kingPos = findKing(color)
  if (!kingPos) return false

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = gameState.board[row][col];
      if (piece && piece.color !== color) {
        if (canPieceAttackSquare(row, col, kingPos.row, kingPos.col)) {
          return true
        }
      }
    }
  }
  return false
}

function isPieceBetween(fromRow, fromCol, toRow, toCol) {
  const rowStep = fromRow === toRow ? 0 : (toRow - fromRow) / Math.abs(toRow - fromRow)
  const colStep = fromCol === toCol ? 0 : (toCol - fromCol) / Math.abs(toCol - fromCol)

  let currentRow = fromRow + rowStep
  let currentCol = fromCol + colStep

  while (currentRow !== toRow || currentCol !== toCol) {
    if (gameState.board[currentRow][currentCol]) return true
    currentRow += rowStep
    currentCol += colStep
  }

  return false
}

function isSquareAttacked(row, col, defendingColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = gameState.board[r][c]
      if (piece && piece.color !== defendingColor) {
        if (canPieceAttackSquare(r, c, row, col)) {
          return true
        }
      }
    }
  }
  return false
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
 * Executes a move on the board and updates the game state
 */
function makeMove(fromRow, fromCol, toRow, toCol) {
  const piece = gameState.board[fromRow][fromCol]
  const targetSquare = gameState.board[toRow][toCol]
  const isCapture = targetSquare !== null
  const oldEnPassantTarget = gameState.enPassantTarget

  // Check for pawn promotion before making the move
  if (piece.type === 'pawn' && (toRow === 0 || toRow === 7)) {
    // Store pending promotion
    gameState.pendingPromotion = { row: toRow, col: toCol, fromRow, fromCol }
    showPromotionDialog(toRow, toCol)
    return // Wait for promotion choice
  }

  // Continue with regular move
  executeMoveAndUpdate(fromRow, fromCol, toRow, toCol, piece.type)
}

function executeMoveAndUpdate(fromRow, fromCol, toRow, toCol, pieceType) {
  const piece = gameState.board[fromRow][fromCol]
  const targetSquare = gameState.board[toRow][toCol]
  const isCapture = targetSquare !== null
  const oldEnPassantTarget = gameState.enPassantTarget

  // Update fifty-move rule counter
  if (pieceType === 'pawn' || isCapture) {
    gameState.halfMoveClock = 0
  } else {
    gameState.halfMoveClock++
  }

  // Handle en passant capture
  if (pieceType === 'pawn' && oldEnPassantTarget && 
      toRow === oldEnPassantTarget[0] && toCol === oldEnPassantTarget[1]) {
    const captureRow = fromRow
    gameState.board[captureRow][toCol] = null
  }

  // Set en passant target for two-square pawn moves
  gameState.enPassantTarget = null
  if (pieceType === 'pawn' && Math.abs(fromRow - toRow) === 2) {
    const enPassantRow = (fromRow + toRow) / 2
    gameState.enPassantTarget = [enPassantRow, fromCol]
  }

  // Handle castling
  if (pieceType === 'king' && Math.abs(fromCol - toCol) === 2) {
    const rookFromCol = toCol > fromCol ? 7 : 0
    const rookToCol = toCol > fromCol ? toCol - 1 : toCol + 1
    const rook = gameState.board[fromRow][rookFromCol]
    gameState.board[fromRow][rookToCol] = rook
    gameState.board[fromRow][rookFromCol] = null
  }

  // Update castling rights
  if (pieceType === 'king') {
    gameState.castlingRights[piece.color].kingSide = false
    gameState.castlingRights[piece.color].queenSide = false
  } else if (pieceType === 'rook') {
    if (fromCol === 0) gameState.castlingRights[piece.color].queenSide = false
    if (fromCol === 7) gameState.castlingRights[piece.color].kingSide = false
  } else if (isCapture) {
    // Check if a rook was captured
    if (targetSquare.type === 'rook') {
      const targetColor = targetSquare.color
      if (toCol === 0) gameState.castlingRights[targetColor].queenSide = false
      if (toCol === 7) gameState.castlingRights[targetColor].kingSide = false
    }
  }

  // Make the move
  gameState.board[toRow][toCol] = piece
  gameState.board[fromRow][fromCol] = null

  // Handle pawn promotion
  if (pieceType === 'pawn' && (toRow === 0 || toRow === 7)) {
    handlePawnPromotion(toRow, toCol)
  }

  // Store position for threefold repetition check
  const position = getBoardPosition()
  gameState.positionHistory.push(position)

  // Update turn and game state
  gameState.currentTurn = gameState.currentTurn === 'white' ? 'black' : 'white'
  clearHighlights()
  createChessBoard()

  // Check game ending conditions
  if (isCheck(gameState.currentTurn)) {
    gameState.isCheck = true
    playSound('checkSound')
    if (isCheckmate(gameState.currentTurn)) {
      playSound('gameOverSound')
      const winner = gameState.currentTurn === 'white' ? 'Black' : 'White'
      setTimeout(() => alert(`Checkmate! ${winner} wins!`), 100)
    }
  } else {
    gameState.isCheck = false
    if (isStalemate(gameState.currentTurn)) {
      playSound('gameOverSound')
      setTimeout(() => alert('Stalemate! The game is a draw.'), 100)
    } else if (isDeadPosition()) {
      playSound('gameOverSound')
      setTimeout(() => alert('Dead position! The game is a draw.'), 100)
    } else if (isThreefoldRepetition()) {
      playSound('gameOverSound')
      setTimeout(() => alert('Threefold repetition! The game is a draw.'), 100)
    } else if (isSeventyFiveMoveRule()) {
      playSound('gameOverSound')
      setTimeout(() => alert('Seventy-five-move rule! The game is a draw.'), 100)
    } else if (isFiftyMoveRule()) {
      playSound('gameOverSound')
      setTimeout(() => alert('Fifty-move rule! The game is a draw.'), 100)
    } else if (isInsufficientMaterial()) {
      playSound('gameOverSound')
      setTimeout(() => alert('Insufficient material! The game is a draw.'), 100)
    }
  }

  updateGameStatus()
  playSound('moveSound')
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
function broadcastMove(fromRow, fromCol, toRow, toCol, promotionPiece = null) {
  const message = {
    type: 'move',
    fromRow,
    fromCol,
    toRow,
    toCol,
    promotionPiece
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
        if (message.promotionPiece) {
          // Execute move with promotion
          executeMoveAndUpdate(message.fromRow, message.fromCol, message.toRow, message.toCol, message.promotionPiece)
          gameState.board[message.toRow][message.toCol].type = message.promotionPiece
        } else {
          makeMove(message.fromRow, message.fromCol, message.toRow, message.toCol)
        }
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

function handlePawnPromotion(row, col) {
  const piece = gameState.board[row][col]
  // For now, automatically promote to queen
  // TODO: Add UI for piece selection
  piece.type = 'queen'
}

function isSquareAttacked(row, col, defendingColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = gameState.board[r][c]
      if (piece && piece.color !== defendingColor) {
        if (isValidMove(r, c, row, col)) return true
      }
    }
  }
  return false
}

function getBoardPosition() {
  return JSON.stringify(gameState.board)
}

function isStalemate(color) {
  if (isCheck(color)) return false
  return !hasLegalMoves(color)
}

function hasLegalMoves(color) {
  for (let fromRow = 0; fromRow < 8; fromRow++) {
    for (let fromCol = 0; fromCol < 8; fromCol++) {
      const piece = gameState.board[fromRow][fromCol]
      if (piece && piece.color === color) {
        for (let toRow = 0; toRow < 8; toRow++) {
          for (let toCol = 0; toCol < 8; toCol++) {
            if (isValidMove(fromRow, fromCol, toRow, toCol)) {
              // Try the move
              const tempPiece = gameState.board[toRow][toCol]
              gameState.board[toRow][toCol] = piece
              gameState.board[fromRow][fromCol] = null
              const inCheck = isCheck(color)
              // Undo the move
              gameState.board[fromRow][fromCol] = piece
              gameState.board[toRow][toCol] = tempPiece
              if (!inCheck) return true
            }
          }
        }
      }
    }
  }
  return false
}

function isThreefoldRepetition() {
  const currentPosition = getBoardPosition()
  return gameState.positionHistory.filter(pos => pos === currentPosition).length >= 3
}

function isSeventyFiveMoveRule() {
  return gameState.halfMoveClock >= 150 // 75 moves = 150 half-moves
}

function isFiftyMoveRule() {
  return gameState.halfMoveClock >= 100 // 50 moves = 100 half-moves
}

function isInsufficientMaterial() {
  let pieces = {
    white: { count: 0, bishops: [], knights: 0 },
    black: { count: 0, bishops: [], knights: 0 }
  }

  // Count pieces
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = gameState.board[row][col]
      if (!piece || piece.type === 'king') continue

      pieces[piece.color].count++
      if (piece.type === 'bishop') {
        pieces[piece.color].bishops.push((row + col) % 2)
      } else if (piece.type === 'knight') {
        pieces[piece.color].knights++
      }
    }
  }

  // Check insufficient material conditions
  for (const color of ['white', 'black']) {
    if (pieces[color].count > 2) return false
    if (pieces[color].count === 2 && pieces[color].knights === 2) return false
    if (pieces[color].count === 1 && pieces[color].bishops.length === 0 && pieces[color].knights === 0) return false
  }

  return true
}

function isDeadPosition() {
  // Count material for each side
  let pieces = {
    white: { count: 0, bishops: [], knights: 0 },
    black: { count: 0, bishops: [], knights: 0 }
  }

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = gameState.board[row][col]
      if (!piece || piece.type === 'king') continue

      pieces[piece.color].count++
      if (piece.type === 'bishop') {
        pieces[piece.color].bishops.push((row + col) % 2)
      } else if (piece.type === 'knight') {
        pieces[piece.color].knights++
      }
    }
  }

  // King vs King
  if (pieces.white.count === 0 && pieces.black.count === 0) return true

  // King and Bishop vs King
  if ((pieces.white.count === 1 && pieces.white.bishops.length === 1 && pieces.black.count === 0) ||
      (pieces.black.count === 1 && pieces.black.bishops.length === 1 && pieces.white.count === 0)) return true

  // King and Knight vs King
  if ((pieces.white.count === 1 && pieces.white.knights === 1 && pieces.black.count === 0) ||
      (pieces.black.count === 1 && pieces.black.knights === 1 && pieces.white.count === 0)) return true

  // King and Bishop vs King and Bishop (same colored squares)
  if (pieces.white.count === 1 && pieces.black.count === 1 &&
      pieces.white.bishops.length === 1 && pieces.black.bishops.length === 1 &&
      pieces.white.bishops[0] === pieces.black.bishops[0]) return true

  return false
}

function showPromotionDialog(row, col) {
  const color = gameState.board[gameState.pendingPromotion.fromRow][gameState.pendingPromotion.fromCol].color
  
  // Create modal container
  const modal = document.createElement('div')
  modal.className = 'promotion-modal'
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  `

  // Create promotion options container
  const container = document.createElement('div')
  container.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 8px;
    display: flex;
    gap: 10px;
  `

  // Available promotion pieces
  const pieces = ['queen', 'rook', 'bishop', 'knight']

  pieces.forEach(pieceType => {
    const pieceButton = document.createElement('div')
    pieceButton.style.cssText = `
      width: 60px;
      height: 60px;
      cursor: pointer;
      border: 2px solid #ccc;
      border-radius: 4px;
      display: flex;
      justify-content: center;
      align-items: center;
      transition: border-color 0.3s;
    `

    const pieceImage = document.createElement('img')
    pieceImage.src = `chesspieces/${PIECES[color][pieceType]}`
    pieceImage.style.width = '50px'
    pieceImage.style.height = '50px'

    pieceButton.appendChild(pieceImage)
    
    // Hover effect
    pieceButton.addEventListener('mouseover', () => {
      pieceButton.style.borderColor = '#666'
    })
    pieceButton.addEventListener('mouseout', () => {
      pieceButton.style.borderColor = '#ccc'
    })

    // Click handler
    pieceButton.addEventListener('click', () => {
      const { fromRow, fromCol, row: toRow, col: toCol } = gameState.pendingPromotion
      
      // Execute the move with the chosen promotion piece
      executeMoveAndUpdate(fromRow, fromCol, toRow, toCol, pieceType)
      
      // Update the piece type
      gameState.board[toRow][toCol].type = pieceType
      
      // Remove the modal
      document.body.removeChild(modal)
      
      // Broadcast the move with promotion
      broadcastMove(fromRow, fromCol, toRow, toCol, pieceType)
    })

    container.appendChild(pieceButton)
  })

  modal.appendChild(container)
  document.body.appendChild(modal)

  // Add keyboard navigation
  const handleKeyPress = (e) => {
    const pieces = ['queen', 'rook', 'bishop', 'knight']
    let selectedIndex = -1

    if (e.key === 'ArrowLeft') {
      selectedIndex = Math.max(0, selectedIndex - 1)
    } else if (e.key === 'ArrowRight') {
      selectedIndex = Math.min(3, selectedIndex + 1)
    } else if (e.key === 'Enter' && selectedIndex !== -1) {
      const pieceType = pieces[selectedIndex]
      const { fromRow, fromCol, row: toRow, col: toCol } = gameState.pendingPromotion
      
      // Execute the move with the chosen promotion piece
      executeMoveAndUpdate(fromRow, fromCol, toRow, toCol, pieceType)
      
      // Update the piece type
      gameState.board[toRow][toCol].type = pieceType
      
      // Remove the modal
      document.body.removeChild(modal)
      
      // Broadcast the move with promotion
      broadcastMove(fromRow, fromCol, toRow, toCol, pieceType)
      
      document.removeEventListener('keydown', handleKeyPress)
    }

    if (selectedIndex !== -1) {
      container.querySelectorAll('.piece-button').forEach((btn, idx) => {
        btn.style.borderColor = idx === selectedIndex ? '#666' : '#ccc'
      })
    }
  }

  document.addEventListener('keydown', handleKeyPress)
}