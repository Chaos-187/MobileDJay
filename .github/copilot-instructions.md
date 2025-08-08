<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

# MobileDJay Project Instructions

This is a Node.js Express web application for mobile customers to request songs and karaoke from a DJ.

## Project Structure
- `server.js` - Main Express server with routes and API endpoints
- `views/` - EJS templates for all pages
- `public/css/` - Custom CSS styling with mobile-first responsive design
- `public/js/` - Client-side JavaScript for interactive features

## Key Features
- Mobile-responsive design using Bootstrap 5
- Three main options: Song Request, Karaoke Request, Send Message
- Customer name input with session storage
- Searchable catalogues for songs and karaoke
- Real-time search with debouncing
- Form validation and error handling
- Loading states and success feedback

## Code Style Guidelines
- Use ES6+ features where appropriate
- Follow semantic HTML structure
- Implement accessibility best practices
- Use Bootstrap classes for consistent styling
- Add Font Awesome icons for visual enhancement
- Include proper error handling and user feedback
- Implement mobile-first responsive design
- Use session storage for user data persistence

## API Endpoints
- `GET /` - Main page
- `GET /song-request` - Song request page
- `GET /karaoke-request` - Karaoke request page  
- `GET /send-message` - Message page
- `GET /api/search/songs` - Search songs API
- `GET /api/search/karaoke` - Search karaoke API
- `POST /submit-*` - Form submission endpoints

## Dependencies
- Express.js for server framework
- EJS for templating
- Bootstrap 5 for responsive UI
- Font Awesome for icons
