#!/bin/bash

# Test script to verify Docker Hub integration
# This script tests the Docker build and push process locally

echo "🧪 Testing Docker Hub Integration"
echo "================================="
echo ""

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Get repository information
REPO_URL=$(git remote get-url origin 2>/dev/null)
if [ -z "$REPO_URL" ]; then
    echo "❌ Error: No remote origin found"
    exit 1
fi

# Extract repository owner and name
if [[ $REPO_URL == *"github.com"* ]]; then
    REPO_PATH=$(echo $REPO_URL | sed 's/.*github.com[:/]\([^.]*\).*/\1/')
    REPO_OWNER=$(echo $REPO_PATH | cut -d'/' -f1)
    REPO_NAME=$(echo $REPO_PATH | cut -d'/' -f2)
else
    echo "❌ Error: Not a GitHub repository"
    exit 1
fi

DOCKERHUB_REPO="$REPO_OWNER/$REPO_NAME"
echo "📦 Testing repository: $DOCKERHUB_REPO"
echo ""

# Test 1: Docker build
echo "🔨 Test 1: Docker Build"
echo "----------------------"
echo "Building Docker image..."

if docker build -t "$DOCKERHUB_REPO:test" . > /dev/null 2>&1; then
    echo "✅ Docker build successful"
else
    echo "❌ Docker build failed"
    exit 1
fi

# Test 2: Health check
echo ""
echo "🏥 Test 2: Health Check"
echo "----------------------"
echo "Testing health check endpoint..."

# Start container in background
CONTAINER_ID=$(docker run -d --name test-frijolebot \
    -e DISCORD_BOT_TOKEN=test \
    -e DISCORD_GUILD_ID=test \
    -e DISCORD_CHANNELS_TO_MONITOR=test \
    -e BASEROW_API_TOKEN=test \
    -e BASEROW_API_URL=test \
    -e NODE_ENV=test \
    -p 3000:3000 \
    "$DOCKERHUB_REPO:test" 2>/dev/null)

if [ -z "$CONTAINER_ID" ]; then
    echo "❌ Failed to start container"
    exit 1
fi

# Wait for container to start
echo "Waiting for container to start..."
sleep 15

# Test health check
if curl -f http://localhost:3000/health/live > /dev/null 2>&1; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    docker logs test-frijolebot
    docker stop test-frijolebot > /dev/null 2>&1
    docker rm test-frijolebot > /dev/null 2>&1
    exit 1
fi

# Clean up
docker stop test-frijolebot > /dev/null 2>&1
docker rm test-frijolebot > /dev/null 2>&1

# Test 3: Docker Hub login (if credentials are available)
echo ""
echo "🔐 Test 3: Docker Hub Authentication"
echo "-----------------------------------"
if docker info | grep -q "Username:"; then
    echo "✅ Docker Hub credentials found"
    echo "You can test push with: docker push $DOCKERHUB_REPO:test"
else
    echo "⚠️  Docker Hub credentials not found"
    echo "Login with: docker login"
    echo "Then test push with: docker push $DOCKERHUB_REPO:test"
fi

# Test 4: Check GitHub Actions secrets
echo ""
echo "🔑 Test 4: GitHub Actions Setup"
echo "------------------------------"
echo "To verify GitHub Actions secrets are configured:"
echo "1. Go to https://github.com/$REPO_OWNER/$REPO_NAME/settings/secrets/actions"
echo "2. Verify these secrets exist:"
echo "   - DOCKERHUB_USERNAME"
echo "   - DOCKERHUB_TOKEN"
echo ""

# Test 5: Workflow files
echo "📋 Test 5: Workflow Files"
echo "------------------------"
if [ -f ".github/workflows/docker-build.yml" ]; then
    echo "✅ docker-build.yml found"
else
    echo "❌ docker-build.yml missing"
fi

if [ -f ".github/workflows/test.yml" ]; then
    echo "✅ test.yml found"
else
    echo "❌ test.yml missing"
fi

if [ -f ".github/workflows/security.yml" ]; then
    echo "✅ security.yml found"
else
    echo "❌ security.yml missing"
fi

# Clean up test image
echo ""
echo "🧹 Cleaning up test image..."
docker rmi "$DOCKERHUB_REPO:test" > /dev/null 2>&1

echo ""
echo "✅ All tests completed!"
echo ""
echo "🚀 Next steps:"
echo "1. Ensure GitHub secrets are configured"
echo "2. Push to main branch to trigger automated build"
echo "3. Check Actions tab for workflow status"
echo "4. Verify image appears in Docker Hub"
echo ""
echo "📚 For troubleshooting, see: .github/workflows/README.md"
