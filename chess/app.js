/**
 * P2P Chess Game Implementation
 * This file implements a peer-to-peer chess game using Hyperswarm for networking.
 * Players can create or join game rooms and play chess while chatting.
 */

// Enable TypeScript-like hints for better code completion
/** @typedef {import('pear-interface')} */

/* global Pear */
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
const { teardown, updates } = Pear

// Initialize P2P networking
const swarm = new Hyperswarm()

// Game state variables
let playerColor = null // 'white' or 'black'
let selectedSquare = null // Currently selected square for piece movement
let draggedPiece = null // Piece being dragged
let draggedPieceElement = null // DOM element of dragged piece
let gameState = {
  board: initializeBoard(),
  currentTurn: 'white', // Track whose turn it is
  gameStarted: false // Game status flag
}

// Cleanup handlers
teardown(() => swarm.destroy())
updates(() => Pear.reload())

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
 * Debug utility to display messages in the debug panel
 * @param {string} message - Message to display
 * @param {string} type - Message type ('info', 'error', 'success')
 */
function debug(message, type = 'info') {
  const debugPanel = document.getElementById('debug-panel')
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

/**
 * Creates and renders the chess board UI
 * Handles piece placement, drag-and-drop, and click events
 */
function createChessBoard() {
  const chessBoard = document.querySelector('#chess-board')
  chessBoard.innerHTML = ''
  debug(`Creating board. Player color: ${playerColor}`)

  gameState.gameStarted = true
  const isBlack = playerColor === 'black'

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
  if (!gameState.gameStarted || gameState.currentTurn !== playerColor) return

  const clickedPiece = gameState.board[row][col]

  if (selectedSquare) {
    if (clickedPiece && clickedPiece.color === playerColor) {
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
  } else if (clickedPiece && clickedPiece.color === playerColor) {
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
}

/**
 * Updates the game status display
 */
function updateGameStatus() {
  const status = document.querySelector('#game-status')
  if (!gameState.gameStarted) {
    status.textContent = 'Waiting for opponent...'
  } else {
    const isYourTurn = gameState.currentTurn === playerColor
    status.textContent = `${gameState.currentTurn.charAt(0).toUpperCase() + gameState.currentTurn.slice(1)}'s turn${isYourTurn ? ' (Your turn)' : ''}`
  }
}

// P2P Communication Setup and Handlers

/**
 * Handle new peer connections
 */
swarm.on('connection', (peer) => {
  // Limit to 2 players
  if (swarm.connections.size > 1) {
    peer.destroy()
    return
  }

  const name = b4a.toString(peer.remotePublicKey, 'hex').substr(0, 6)

  // Handle incoming messages
  peer.on('data', data => {
    try {
      const message = JSON.parse(b4a.toString(data))
      if (message.type === 'move') {
        handleGameMessage(message)
      } else {
        onMessageAdded(name, b4a.toString(data))
      }
    } catch (e) {
      // Non-JSON messages are treated as chat
      onMessageAdded(name, b4a.toString(data))
    }
  })

  peer.on('error', e => console.log(`Connection error: ${e}`))
})

/**
 * Handle peer connection updates
 */
swarm.on('update', () => {
  document.querySelector('#peers-count').textContent = swarm.connections.size

  if (swarm.connections.size === 1 && !gameState.gameStarted) {
    startGame()
  }
})

/**
 * Initialize game when opponent joins
 */
function startGame() {
  gameState.gameStarted = true
  playerColor = swarm.connections.size === 1 ? 'black' : 'white'
  createChessBoard()
  updateGameStatus()
}

/**
 * Handle incoming game messages from opponent
 */
function handleGameMessage(message) {
  switch (message.type) {
    case 'move':
      if (gameState.currentTurn !== playerColor) {
        makeMove(message.fromRow, message.fromCol, message.toRow, message.toCol)
      }
      break
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

// Event Listeners for UI Elements
document.querySelector('#create-chat-room').addEventListener('click', createChatRoom)
document.querySelector('#join-form').addEventListener('submit', joinChatRoom)
document.querySelector('#message-form').addEventListener('submit', sendMessage)

/**
 * Create a new game room with random topic
 */
async function createChatRoom() {
  const topicBuffer = crypto.randomBytes(32)
  joinSwarm(topicBuffer)
}

/**
 * Join an existing game room
 */
async function joinChatRoom(e) {
  e.preventDefault()
  const topicStr = document.querySelector('#join-chat-room-topic').value
  const topicBuffer = b4a.from(topicStr, 'hex')
  joinSwarm(topicBuffer)
}

/**
 * Connect to the P2P network
 */
async function joinSwarm(topicBuffer) {
  document.querySelector('#setup').classList.add('hidden')
  document.querySelector('#loading').classList.remove('hidden')

  const discovery = swarm.join(topicBuffer, { client: true, server: true })
  await discovery.flushed()

  const topic = b4a.toString(topicBuffer, 'hex')
  document.querySelector('#room-topic-display').value = topic
  document.querySelector('#loading').classList.add('hidden')
  document.querySelector('#game-container').classList.remove('hidden')

  createChessBoard()
  updateGameStatus()
}

/**
 * Send chat message to opponent
 */
function sendMessage(e) {
  e.preventDefault()
  const message = document.querySelector('#message').value
  document.querySelector('#message').value = ''

  onMessageAdded('You', message)

  const peers = [...swarm.connections]
  for (const peer of peers) peer.write(b4a.from(message))
}

/**
 * Display chat message in the UI
 */
function onMessageAdded(from, message) {
  const $div = document.createElement('div')
  $div.textContent = `<${from}> ${message}`
  document.querySelector('#messages').appendChild($div)
}

/**
 * Copy room topic to clipboard and show feedback
 */
window.copyRoomTopic = async function () {
  const roomTopic = document.querySelector('#room-topic-display').value
  await navigator.clipboard.writeText(roomTopic)

  // Show tooltip
  const button = document.querySelector('.copy-button')
  const tooltip = document.createElement('div')
  tooltip.className = 'tooltip'
  tooltip.textContent = 'Copied!'
  tooltip.style.top = '-30px'
  tooltip.style.left = '50%'
  tooltip.style.transform = 'translateX(-50%)'

  button.style.position = 'relative'
  button.appendChild(tooltip)

  // Show and remove tooltip with animation
  setTimeout(() => tooltip.classList.add('visible'), 0)
  setTimeout(() => {
    tooltip.classList.remove('visible')
    setTimeout(() => tooltip.remove(), 200)
  }, 1500)
}