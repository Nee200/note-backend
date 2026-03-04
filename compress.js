const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = 'C:\\Webserver\\OnlineShop\\frontend\\images_parfume';

async function compressImages() {
    console.log('Starting compression...');
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file.toLowerCase().endsWith('.png') || file.toLowerCase().endsWith('.jpg')) {
            const filepath = path.join(dir, file);
            const tempFile = filepath + '.tmp.png';

            try {
                // Resize to max 600px width, compress PNG heavily
                await sharp(filepath)
                    .resize({ width: 600, withoutEnlargement: true })
                    .png({ palette: true, compressionLevel: 9, quality: 70 })
                    .toFile(tempFile);

                // Replace original
                fs.renameSync(tempFile, filepath);
                console.log(`Compressed ${file}`);
            } catch (e) {
                console.error(`Error compressing ${file}:`, e);
            }
        }
    }
    console.log('All done!');
}

compressImages();
