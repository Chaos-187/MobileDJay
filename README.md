# MobileDJay

A mobile-responsive web application that allows customers to search for and request songs, karaoke tracks, and send messages to the DJ.

## Features

- **Mobile-First Design**: Optimized for mobile devices with responsive Bootstrap 5 UI
- **Song Requests**: Browse and search through a catalogue of songs loaded from VirtualDJ XML database
- **Karaoke Requests**: Find karaoke tracks loaded from CSV file with auto-assigned difficulty ratings
- **Message System**: Send custom messages to the DJ via VirtualDJ API
- **Real-time Search**: Live search functionality with debouncing across title, artist, genre/album
- **Customer Names**: Persistent customer name storage across sessions
- **Form Validation**: Client and server-side validation
- **Loading States**: Visual feedback during form submissions
- **VirtualDJ Integration**: All requests are sent directly to VirtualDJ endpoint

## Technology Stack

- **Backend**: Node.js with Express.js
- **Templating**: EJS (Embedded JavaScript)
- **Frontend**: Bootstrap 5, Font Awesome, Vanilla JavaScript
- **Styling**: Custom CSS with CSS animations and transitions
- **Data Sources**: VirtualDJ XML database for songs, CSV file for karaoke
- **XML Parsing**: xml2js for VirtualDJ database parsing
- **CSV Parsing**: csv-parser for karaoke catalogue
- **External API**: HTTPS requests to VirtualDJ endpoint

## Installation

1. Clone or download the project
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The application will be available at `http://localhost:3000`

## Project Structure

```
MobileDJay/
├── server.js              # Main Express server
├── package.json           # Project dependencies and scripts
├── views/                 # EJS templates
│   ├── index.ejs         # Main page
│   ├── song-request.ejs  # Song request page
│   ├── karaoke-request.ejs # Karaoke request page
│   ├── send-message.ejs  # Message page
│   └── thank-you.ejs     # Confirmation page
├── public/               # Static assets
│   ├── css/
│   │   └── style.css     # Custom styles
│   └── js/
│       ├── app.js        # Main JavaScript
│       ├── song-request.js # Song page functionality
│       ├── karaoke-request.js # Karaoke page functionality
│       └── send-message.js # Message page functionality
└── .github/
    └── copilot-instructions.md # Copilot customization
```

## API Endpoints

- `GET /` - Main page with three options
- `GET /song-request` - Song request page
- `GET /karaoke-request` - Karaoke request page
- `GET /send-message` - Message page
- `GET /api/search/songs?q=query` - Search songs API
- `GET /api/search/karaoke?q=query` - Search karaoke API
- `POST /submit-song-request` - Submit song request
- `POST /submit-karaoke-request` - Submit karaoke request
- `POST /submit-message` - Submit message

## Data Sources

The application automatically loads data from:

- **Songs**: `DB/Song_Database.xml` - VirtualDJ XML database format
- **Karaoke**: `DB/VirtualDJ_Karaoke_Catalog_2025-07-26.csv` - CSV format with Artist, Title, Genre columns

### Song Database Format
The XML database should follow VirtualDJ format:
```xml
<Song FilePath="...">
  <Tags Author="Artist Name" Title="Song Title" Album="Album Name" Year="2024" />
  <!-- other VirtualDJ data -->
</Song>
```

### Karaoke CSV Format
The CSV should have columns: `Artist,Title,Genre,Date Added`

If database files are not found, the application falls back to sample data.

## Customization

### Adding Songs/Karaoke
- Update your VirtualDJ XML database file in the `DB/` folder
- Update your karaoke CSV file in the `DB/` folder  
- Restart the server to reload the catalogues

### Styling
Modify `public/css/style.css` to customize the appearance.

### Search Functionality
The search is case-insensitive and searches across title, artist, and genre/difficulty fields.

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge
- Mobile browsers (iOS Safari, Chrome Mobile)

## License

ISC License
