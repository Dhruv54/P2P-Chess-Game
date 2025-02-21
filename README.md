# P2P Chess Game

A real-time peer-to-peer chess game built with modern web technologies. Play chess with friends directly through your browser with no server required!

## 🌟 Features

- ♟️ Real-time P2P chess gameplay
- 🎯 Valid move highlighting
- 🖱️ Drag and drop piece movement
- 🔄 Automatic board perspective for both players
- 🎮 Game state synchronization
- 📊 Debug panel for development
- 🎨 Clean and professional UI

## 🚀 Getting Started

### Prerequisites

- Node.js installed on your system
- A modern web browser

### Installation

1. Clone the repository:
```bash
git clone [your-repository-url]
cd Final_Chess
```

2. Install dependencies:
```bash
npm install
```

3. Start the application:
```bash
npm start
```

## 🎮 How to Play

1. **Starting a Game**
   - Launch the application
   - Click "Create Game" to start a new game
   - Share your game ID with a friend

2. **Joining a Game**
   - Click "Join Game"
   - Enter the game ID shared by your friend
   - Wait for connection

3. **Playing**
   - The creator plays as White
   - The joiner plays as Black
   - Drag and drop pieces to make moves
   - Valid moves are highlighted in green

## 🛠️ Technical Details

### Technologies Used
- HTML5/CSS3
- JavaScript (ES6+)
- Hyperswarm (P2P networking)
- Custom Chess Engine

### Architecture
- Peer-to-peer connection using Hyperswarm
- Real-time game state synchronization
- Client-side move validation
- Event-driven architecture

## 🐛 Known Issues and Solutions

1. **Drag and Drop Issues**
   - Initial issues with piece dragging on rotated board
   - Solution: Implemented coordinate mapping instead of board rotation
   - Current Status: Fixed ✅

2. **Board Orientation**
   - Challenge: Maintaining correct piece orientation for both players
   - Solution: Using coordinate transformation instead of visual rotation
   - Current Status: Fixed ✅

3. **Move Validation**
   - Edge cases in pawn promotion and en passant
   - Solution: Additional validation rules implemented
   - Current Status: In Progress 🔄

## 🔜 Future Improvements

1. **Planned Features**
   - Move history and notation
   - Game clock integration
   - Spectator mode
   - Chat functionality

2. **UI Enhancements**
   - Piece move animations
   - Sound effects
   - Responsive design for mobile

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 Development Notes

### Debug Mode
- A debug panel is available showing:
  - Move validation
  - Game state changes
  - P2P connection status
  - Error messages

### Testing
To test piece movement without game rules:
1. Comment out game state checks in app.js
2. All pieces become draggable
3. Move validation still applies

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Chess piece images from [chess.com](https://chess.com)
- P2P networking inspiration from Hyperswarm documentation
- Community feedback and contributions
