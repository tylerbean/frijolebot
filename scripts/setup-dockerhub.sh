#!/bin/bash

# Setup script for Docker Hub integration with GitHub Actions
# This script helps you configure the necessary secrets for automated Docker builds

echo "🐳 Docker Hub Integration Setup for GitHub Actions"
echo "=================================================="
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

echo "📋 Repository: $REPO_OWNER/$REPO_NAME"
echo ""

# Instructions for Docker Hub setup
echo "🔧 Step 1: Create Docker Hub Access Token"
echo "----------------------------------------"
echo "1. Go to https://hub.docker.com/"
echo "2. Sign in to your Docker Hub account"
echo "3. Click on your profile → Account Settings"
echo "4. Go to Security → New Access Token"
echo "5. Give it a name (e.g., 'GitHub Actions - $REPO_NAME')"
echo "6. Set permissions to 'Read, Write, Delete'"
echo "7. Click 'Generate' and copy the token"
echo ""

# Instructions for GitHub secrets
echo "🔐 Step 2: Add GitHub Secrets"
echo "-----------------------------"
echo "1. Go to https://github.com/$REPO_OWNER/$REPO_NAME/settings/secrets/actions"
echo "2. Click 'New repository secret'"
echo "3. Add these secrets:"
echo ""
echo "   Name: DOCKERHUB_USERNAME"
echo "   Value: [Your Docker Hub username]"
echo ""
echo "   Name: DOCKERHUB_TOKEN"
echo "   Value: [Your Docker Hub access token from Step 1]"
echo ""

# Test the setup
echo "🧪 Step 3: Test the Setup"
echo "------------------------"
echo "After adding the secrets, you can test by:"
echo "1. Making a small change to the repository"
echo "2. Pushing to the main branch"
echo "3. Checking the Actions tab for the build workflow"
echo "4. Verifying the Docker image appears in your Docker Hub repository"
echo ""

# Docker Hub repository name
DOCKERHUB_REPO="$REPO_OWNER/$REPO_NAME"
echo "📦 Expected Docker Hub Repository: $DOCKERHUB_REPO"
echo ""

# Quick commands
echo "🚀 Quick Commands"
echo "----------------"
echo "# Test Docker build locally:"
echo "docker build -t $DOCKERHUB_REPO ."
echo ""
echo "# Pull the latest image (after first successful build):"
echo "docker pull $DOCKERHUB_REPO:latest"
echo ""
echo "# Run the container:"
echo "docker run -d --name frijolebot --env-file .env $DOCKERHUB_REPO:latest"
echo ""

# Workflow information
echo "📋 Workflow Information"
echo "----------------------"
echo "The following workflows will be triggered:"
echo ""
echo "• docker-build.yml:"
echo "  - Triggers: Push to main/develop, tags, PRs"
echo "  - Builds multi-arch Docker images"
echo "  - Pushes to Docker Hub (main branch and tags only)"
echo "  - Runs security scans"
echo "  - Creates GitHub releases for tags"
echo ""
echo "• test.yml:"
echo "  - Triggers: Push to main/develop, PRs"
echo "  - Runs unit tests"
echo "  - Checks syntax"
echo "  - Tests Docker build"
echo "  - Verifies health checks"
echo ""
echo "• security.yml:"
echo "  - Triggers: Weekly schedule, push to main, PRs"
echo "  - Runs npm audit"
echo "  - Scans Docker images with Trivy"
echo "  - Updates GitHub Security tab"
echo ""

echo "✅ Setup complete! Follow the steps above to configure Docker Hub integration."
echo ""
echo "📚 For detailed documentation, see: .github/workflows/README.md"
