# GitHub Actions Workflows

This directory contains GitHub Actions workflows for automated CI/CD processes.

## Workflows

### 1. `docker-build.yml` - Docker Build and Push

**Triggers:**
- Push to `main` or `develop` branches
- Push tags starting with `v*`
- Pull requests to `main`

**Features:**
- Multi-architecture builds (linux/amd64, linux/arm64)
- Automatic tagging based on branch/tag
- Docker Hub push (on main branch and tags)
- Security scanning with Trivy
- Software Bill of Materials (SBOM) generation
- Container health check testing
- GitHub releases for tags

**Required Secrets:**
- `DOCKERHUB_USERNAME` - Docker Hub username
- `DOCKERHUB_TOKEN` - Docker Hub access token

### 2. `test.yml` - Testing and Linting

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main`

**Features:**
- Node.js 18 setup
- npm dependency installation
- Unit test execution
- JavaScript syntax checking
- Docker build testing
- Health check endpoint testing

### 3. `security.yml` - Security Scanning

**Triggers:**
- Weekly schedule (Mondays at 9 AM UTC)
- Push to `main` branch
- Pull requests to `main`

**Features:**
- npm audit for dependency vulnerabilities
- Trivy container security scanning
- GitHub Security tab integration
- Audit results artifact upload

## Setup Instructions

### 1. Docker Hub Integration

To enable automatic Docker image pushes:

1. Go to your GitHub repository settings
2. Navigate to "Secrets and variables" → "Actions"
3. Add the following secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username
   - `DOCKERHUB_TOKEN`: Your Docker Hub access token

### 2. Docker Hub Token Creation

1. Go to [Docker Hub](https://hub.docker.com/)
2. Navigate to "Account Settings" → "Security"
3. Click "New Access Token"
4. Give it a name (e.g., "GitHub Actions")
5. Set permissions to "Read, Write, Delete"
6. Copy the token and add it as `DOCKERHUB_TOKEN` secret

### 3. Repository Permissions

Ensure your repository has the following permissions:
- Contents: Read
- Packages: Write
- Security events: Write

## Workflow Features

### Multi-Architecture Support

The Docker build workflow supports multiple architectures:
- `linux/amd64` - Standard x86_64
- `linux/arm64` - ARM64 (Apple Silicon, ARM servers)

### Automatic Tagging

Images are automatically tagged based on:
- Branch name (e.g., `main`, `develop`)
- Git tags (e.g., `v1.0.0`)
- SHA (e.g., `main-abc1234`)
- Latest tag for main branch

### Security Features

- **Trivy Scanning**: Container vulnerability scanning
- **SBOM Generation**: Software Bill of Materials
- **npm Audit**: Dependency vulnerability checking
- **GitHub Security Tab**: Integration with GitHub's security features

### Health Check Testing

Each build includes:
- Container startup testing
- Health endpoint verification (`/health/live`)
- Automatic cleanup

## Usage Examples

### Manual Release

To create a new release:

```bash
# Create and push a tag
git tag v1.0.0
git push origin v1.0.0
```

This will:
1. Build the Docker image
2. Push to Docker Hub with tag `v1.0.0`
3. Create a GitHub release
4. Run security scans

### Pull Request Testing

Every pull request automatically:
1. Runs unit tests
2. Checks syntax
3. Tests Docker build
4. Verifies health checks

### Weekly Security Scan

Every Monday, the security workflow:
1. Checks for new vulnerabilities
2. Scans the latest Docker image
3. Updates GitHub Security tab

## Monitoring

### Workflow Status

Check workflow status in:
- GitHub Actions tab
- Pull request checks
- Repository status badges

### Security Alerts

Security issues are reported in:
- GitHub Security tab
- Workflow artifacts
- Pull request comments (if configured)

## Troubleshooting

### Common Issues

1. **Docker Hub Authentication Failed**
   - Verify `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets
   - Check token permissions

2. **Health Check Failed**
   - Verify environment variables are set
   - Check if port 3000 is accessible

3. **Build Failed**
   - Check Dockerfile syntax
   - Verify all required files are present
   - Check .dockerignore configuration

### Debug Mode

To enable debug logging, add this to your workflow:

```yaml
- name: Enable debug logging
  run: echo "ACTIONS_STEP_DEBUG=true" >> $GITHUB_ENV
```
