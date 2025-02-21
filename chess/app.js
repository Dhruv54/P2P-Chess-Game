// For interactive documentation and code auto-completion in editor
/** @typedef {import('pear-interface')} */ 

/* global Pear */
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
const { teardown, updates } = Pear

const swarm = new Hyperswarm()
let playerColor = null
let selectedSquare = null
let draggedPiece = null
let draggedPieceElement = null
let gameState = {
  board: initializeBoard(),
  currentTurn: 'white',
  gameStarted: false
}

teardown(() => swarm.destroy())
updates(() => Pear.reload())

// Chess piece mappings
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

function initializeBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(null))
  
  // Set up pawns
  for (let i = 0; i < 8; i++) {
    board[1][i] = { type: 'pawn', color: 'black' }
    board[6][i] = { type: 'pawn', color: 'white' }
  }

  // Set up other pieces
  const backRow = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook']
  for (let i = 0; i < 8; i++) {
    board[0][i] = { type: backRow[i], color: 'black' }
    board[7][i] = { type: backRow[i], color: 'white' }
  }

  return board
}

// Debug utilities
function debug(message, type = 'info') {
  const debugPanel = document.getElementById('debug-panel')
  const entry = document.createElement('div')
  entry.className = `debug-entry ${type}`
  entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`
  debugPanel.appendChild(entry)
  debugPanel.scrollTop = debugPanel.scrollHeight
  console.log(`[${type}] ${message}`)
  
  // Keep only last 50 messages
  while (debugPanel.children.length > 50) {
    debugPanel.removeChild(debugPanel.firstChild)
  }
}

function createChessBoard() {
  const chessBoard = document.querySelector('#chess-board')
  chessBoard.innerHTML = ''
  debug(`Creating board. Player color: ${playerColor}`)
  
  // For testing, always set game as started
  gameState.gameStarted = true
  
  // For black's perspective, we'll reverse the internal coordinates but keep the board visually the same
  const isBlack = playerColor === 'black'
  
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement('div')
      // Calculate the actual board position based on player's color
      const actualRow = isBlack ? 7 - row : row
      const actualCol = isBlack ? 7 - col : col
      
      square.className = `chess-square ${(row + col) % 2 === 0 ? 'white' : 'black'}`
      square.dataset.row = actualRow.toString()
      square.dataset.col = actualCol.toString()
      
      const piece = gameState.board[actualRow][actualCol]
      if (piece) {
        const img = document.createElement('img')
        img.src = `chesspieces/${PIECES[piece.color][piece.type]}`
        img.className = 'chess-piece'
        img.draggable = true
        img.dataset.row = actualRow.toString()
        img.dataset.col = actualCol.toString()

        // Drag start
        img.addEventListener('dragstart', function(e) {
          debug(`Dragstart triggered on ${piece.color} ${piece.type} at ${actualRow},${actualCol}`)
          
        //   // Check game state
        //   if (!gameState.gameStarted) {
        //     debug('Cannot drag: Game not started', 'error')
        //     e.preventDefault()
        //     return false
        //   }
          
        //   // Check turn
        //   if (gameState.currentTurn !== playerColor) {
        //     debug(`Cannot drag: Not your turn. Current turn: ${gameState.currentTurn}, Your color: ${playerColor}`, 'error')
        //     e.preventDefault()
        //     return false
        //   }
          
        //   // Check piece color
        //   if (piece.color !== playerColor) {
        //     debug(`Cannot drag: Not your piece. Piece color: ${piece.color}, Your color: ${playerColor}`, 'error')
        //     e.preventDefault()
        //     return false
        //   }

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
          
          // Show valid moves
          const validSquares = []
          for(let r = 0; r < 8; r++) {
            for(let c = 0; c < 8; c++) {
              if(isValidMove(actualRow, actualCol, r, c)) {
                validSquares.push([r, c])
              }
            }
          }
          debug(`Found ${validSquares.length} valid moves`)
          
          validSquares.forEach(([r, c]) => {
            // Convert coordinates back to visual position for black
            const visualRow = isBlack ? 7 - r : r
            const visualCol = isBlack ? 7 - c : c
            const square = document.querySelector(`.chess-square[data-row="${r}"][data-col="${c}"]`)
            if(square) {
              square.classList.add('valid-drop')
              debug(`Highlighted square ${r},${c} as valid move`)
            }
          })
        })

        square.appendChild(img)
      }

      // Handle drops
      square.addEventListener('dragover', function(e) {
        e.preventDefault() // Allow drop
      })

      square.addEventListener('drop', function(e) {
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
        
        // Clean up
        draggedPieceElement.classList.remove('dragging')
        draggedPieceElement = null
        draggedPiece = null
        document.querySelectorAll('.chess-square').forEach(sq => sq.classList.remove('valid-drop'))
        debug('Drag and drop cleanup completed')
      })

      square.addEventListener('click', () => handleSquareClick(actualRow, actualCol))
      chessBoard.appendChild(square)
    }
  }
  
  // Clean up any failed drags
  document.addEventListener('dragend', function() {
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

function selectSquare(row, col) {
  // Clear previous selection
  clearHighlights()
  
  selectedSquare = [row, col]
  const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`)
  square.classList.add('selected')
  
  // Highlight valid moves
  const validSquares = []
  for(let r = 0; r < 8; r++) {
    for(let c = 0; c < 8; c++) {
      if(isValidMove(row, col, r, c)) {
        validSquares.push([r, c])
      }
    }
  }
  
  // Highlight valid squares
  validSquares.forEach(([r, c]) => {
    const square = document.querySelector(`.chess-square[data-row="${r}"][data-col="${c}"]`)
    if(square) square.classList.add('valid-move')
  })
}

function clearHighlights() {
  document.querySelectorAll('.chess-square').forEach(square => {
    square.classList.remove('selected', 'valid-move', 'valid-drop', 'invalid-drop')
  })
  selectedSquare = null
}

function isValidMove(fromRow, fromCol, toRow, toCol) {
  const piece = gameState.board[fromRow][fromCol]
  const targetSquare = gameState.board[toRow][toCol]
  
  // Basic validation
  if (fromRow === toRow && fromCol === toCol) return false
  if (toRow < 0 || toRow > 7 || toCol < 0 || toCol > 7) return false
  
  // For testing, allow capturing any piece
  if (targetSquare && targetSquare.color === piece.color) return false
  
  switch (piece.type) {
    case 'pawn':
      // Allow pawns to move forward 1 or 2 squares
      const direction = piece.color === 'white' ? -1 : 1
      const startRow = piece.color === 'white' ? 6 : 1
      
      // Moving forward
      if (fromCol === toCol && !targetSquare) {
        if (toRow === fromRow + direction) return true
        if (fromRow === startRow && toRow === fromRow + 2 * direction && !gameState.board[fromRow + direction][fromCol]) return true
      }
      
      // Capturing
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

function makeMove(fromRow, fromCol, toRow, toCol) {
  const piece = gameState.board[fromRow][fromCol]
  gameState.board[toRow][toCol] = piece
  gameState.board[fromRow][fromCol] = null
  gameState.currentTurn = gameState.currentTurn === 'white' ? 'black' : 'white'
  clearHighlights()
  createChessBoard()
  updateGameStatus()
}

function updateGameStatus() {
  const status = document.querySelector('#game-status')
  if (!gameState.gameStarted) {
    status.textContent = 'Waiting for opponent...'
  } else {
    const isYourTurn = gameState.currentTurn === playerColor
    status.textContent = `${gameState.currentTurn.charAt(0).toUpperCase() + gameState.currentTurn.slice(1)}'s turn${isYourTurn ? ' (Your turn)' : ''}`
  }
}

// P2P Communication
swarm.on('connection', (peer) => {
  // Only allow 2 peers in a room
  if (swarm.connections.size > 1) {
    peer.destroy()
    return
  }

  const name = b4a.toString(peer.remotePublicKey, 'hex').substr(0, 6)
  
  peer.on('data', data => {
    try {
      const message = JSON.parse(b4a.toString(data))
      if (message.type === 'move') {
        handleGameMessage(message)
      } else {
        onMessageAdded(name, b4a.toString(data))
      }
    } catch (e) {
      // If not JSON, treat as chat message
      onMessageAdded(name, b4a.toString(data))
    }
  })
  
  peer.on('error', e => console.log(`Connection error: ${e}`))
})

swarm.on('update', () => {
  document.querySelector('#peers-count').textContent = swarm.connections.size
  
  if (swarm.connections.size === 1 && !gameState.gameStarted) {
    startGame()
  }
})

function startGame() {
  gameState.gameStarted = true
  // Creator is white, joiner is black
  playerColor = swarm.connections.size === 1 ? 'black' : 'white'
  createChessBoard()
  updateGameStatus()
}

function handleGameMessage(message) {
  switch (message.type) {
    case 'move':
      if (gameState.currentTurn !== playerColor) {
        makeMove(message.fromRow, message.fromCol, message.toRow, message.toCol)
      }
      break
  }
}

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

document.querySelector('#create-chat-room').addEventListener('click', createChatRoom)
document.querySelector('#join-form').addEventListener('submit', joinChatRoom)
document.querySelector('#message-form').addEventListener('submit', sendMessage)

async function createChatRoom() {
  const topicBuffer = crypto.randomBytes(32)
  joinSwarm(topicBuffer)
}

async function joinChatRoom(e) {
  e.preventDefault()
  const topicStr = document.querySelector('#join-chat-room-topic').value
  const topicBuffer = b4a.from(topicStr, 'hex')
  joinSwarm(topicBuffer)
}

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

function sendMessage(e) {
  e.preventDefault()
  const message = document.querySelector('#message').value
  document.querySelector('#message').value = ''

  onMessageAdded('You', message)

  const peers = [...swarm.connections]
  for (const peer of peers) peer.write(b4a.from(message))
}

function onMessageAdded(from, message) {
  const $div = document.createElement('div')
  $div.textContent = `<${from}> ${message}`
  document.querySelector('#messages').appendChild($div)
}

// Copy room topic functionality
window.copyRoomTopic = async function() {
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
  
  // Show tooltip
  setTimeout(() => tooltip.classList.add('visible'), 0)
  
  // Remove tooltip
  setTimeout(() => {
    tooltip.classList.remove('visible')
    setTimeout(() => tooltip.remove(), 200)
  }, 1500)
}