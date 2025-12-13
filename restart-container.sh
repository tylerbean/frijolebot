#!/bin/bash
set -e

echo "🔄 Restarting frijolebot container..."
echo ""

# Stop and remove existing container
echo "Stopping existing container..."
podman stop frijolebot-test 2>/dev/null || true
podman rm frijolebot-test 2>/dev/null || true

# Start new container
echo "Starting new container..."
container_id=$(podman run -d --name frijolebot-test -p 3000:3000 --env-file .env localhost/frijolebot:local-test)

echo ""
echo "✅ Container restarted!"
echo ""
echo "To view logs:"
echo "  podman logs -f frijolebot-test"
echo ""
echo "Health check:"
echo "  http://localhost:3000/health"
echo ""
echo "Admin UI:"
echo "  http://localhost:3000/admin"

podman logs -f $container_id
