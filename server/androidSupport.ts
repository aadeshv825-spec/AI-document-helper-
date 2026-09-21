import express from 'express';
import path from 'path';

export function setupAndroidAssetServing(app: express.Express) {
  // Serves android app package or metadata if needed
  app.get('/.well-known/assetlinks.json', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', '.well-known', 'assetlinks.json'));
  });
}
