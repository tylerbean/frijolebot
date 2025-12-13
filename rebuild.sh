#!/bin/bash
set -e

echo "🔨 Building frijolebot Docker image..."
echo ""

# Build the image
podman build -t localhost/frijolebot:local-test .

echo ""
echo "✅ Build complete!"
echo ""
echo "Image: localhost/frijolebot:local-test"
echo ""
echo "To run:"
echo "  podman stop frijolebot-test 2>/dev/null || true"
echo "  podman rm frijolebot-test 2>/dev/null || true"
echo "  podman run -d --name frijolebot-test -p 3000:3000 --env-file .env localhost/frijolebot:local-test"
echo ""
echo "To view logs:"
echo "  podman logs -f frijolebot-test"
