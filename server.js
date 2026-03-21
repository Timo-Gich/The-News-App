const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const PUBLIC_DIR = __dirname;

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject'
};

const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);

    // Handle GitHub Pages URL quirks
    if (!fs.existsSync(filePath)) {
        if (req.url.endsWith('/')) {
            filePath = path.join(PUBLIC_DIR, req.url + 'index.html');
        } else {
            filePath = path.join(PUBLIC_DIR, req.url + '/index.html');
        }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // 404 - File not found
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>404 - Not Found</title>
                        <style>
                            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                            h1 { color: #333; }
                            p { color: #666; }
                        </style>
                    </head>
                    <body>
                        <h1>404 - Page Not Found</h1>
                        <p>The requested file was not found.</p>
                        <p><a href="/">Go Home</a></p>
                    </body>
                    </html>
                `);
            } else {
                // 500 - Internal Server Error
                res.writeHead(500);
                res.end('Server Error: ' + err.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log('Press Ctrl+C to stop the server');
});