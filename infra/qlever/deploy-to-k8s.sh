#!/bin/bash
set -euo pipefail

#########################################
# QLever Kubernetes Deployment Script
#########################################
#
# This script automates the deployment of QLever to Kubernetes
# with Caddy Ingress Controller and Calico Network Policies
#
# Usage:
#   ./deploy.sh install    # Full installation (Caddy + QLever)
#   ./deploy.sh qlever     # Deploy QLever only
#   ./deploy.sh caddy      # Deploy Caddy only
#   ./deploy.sh status     # Check deployment status
#   ./deploy.sh logs       # Follow QLever logs
#   ./deploy.sh shell      # Open shell in QLever pod
#   ./deploy.sh delete     # Delete QLever resources
#   ./deploy.sh uninstall  # Delete everything (Caddy + QLever)
#

# Configuration
NAMESPACE="qlever"
CADDY_NAMESPACE="caddy-system"
DOMAIN="${QLEVER_DOMAIN:-qlever.example.com}"
EMAIL="${QLEVER_EMAIL:-your-email@example.com}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

check_requirements() {
    info "Checking requirements..."
    
    if ! command -v kubectl &> /dev/null; then
        error "kubectl not found. Please install kubectl."
    fi
    
    if ! command -v helm &> /dev/null; then
        warn "helm not found. Caddy installation will be skipped."
    fi
    
    if ! kubectl cluster-info &> /dev/null; then
        error "Cannot connect to Kubernetes cluster. Check your kubeconfig."
    fi
    
    info "✓ Requirements satisfied"
}

install_caddy() {
    info "Installing Caddy Ingress Controller..."
    
    if ! command -v helm &> /dev/null; then
        error "helm is required to install Caddy. Please install helm first."
    fi
    
    # Check if values file exists
    if [ ! -f "k8s/helm/caddy-ingress-values.yaml" ]; then
        error "k8s/helm/caddy-ingress-values.yaml not found"
    fi
    
    # Update email in values file
    if [ "$EMAIL" != "your-email@example.com" ]; then
        info "Configuring email: $EMAIL"
        sed -i.bak "s/your-email@example.com/$EMAIL/" k8s/helm/caddy-ingress-values.yaml
    else
        warn "Using default email. Set QLEVER_EMAIL environment variable to change."
    fi
    
    # Create namespace
    kubectl create namespace $CADDY_NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
    kubectl label namespace $CADDY_NAMESPACE name=$CADDY_NAMESPACE --overwrite
    
    # Install Caddy via Helm
    helm upgrade --install \
        --namespace $CADDY_NAMESPACE \
        --repo https://caddyserver.github.io/ingress/ \
        mycaddy \
        caddy-ingress-controller \
        -f k8s/helm/caddy-ingress-values.yaml
    
    info "✓ Caddy Ingress Controller installed"
    info "Waiting for LoadBalancer IP..."
    
    # Wait for LoadBalancer IP
    kubectl wait --for=condition=Ready pod \
        -l app.kubernetes.io/name=caddy-ingress-controller \
        -n $CADDY_NAMESPACE \
        --timeout=120s || warn "Caddy pods not ready yet"
    
    LB_IP=$(kubectl get svc -n $CADDY_NAMESPACE -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "pending")
    if [ "$LB_IP" != "pending" ] && [ -n "$LB_IP" ]; then
        info "✓ LoadBalancer IP: $LB_IP"
        info "Configure DNS: $DOMAIN -> $LB_IP"
    else
        warn "LoadBalancer IP not assigned yet. Check with: kubectl get svc -n $CADDY_NAMESPACE"
    fi
}

generate_access_token() {
    info "Generating secure access token..."
    
    # Generate random token
    TOKEN=$(openssl rand -base64 32)
    
    # Update secrets file
    sed -i.bak "s/CHANGE-ME-TO-SECURE-TOKEN/$TOKEN/" base/01-secrets.yaml
    
    info "✓ Access token generated and saved to base/01-secrets.yaml"
    info "Token (save this): $TOKEN"
}

configure_domain() {
    info "Configuring domain: $DOMAIN"
    
    # Update ingress file
    sed -i.bak "s/qlever.example.com/$DOMAIN/g" base/06-ingress.yaml
    
    info "✓ Domain configured in base/06-ingress.yaml"
}

deploy_qlever() {
    info "Deploying QLever..."
    
    # Check if secrets have been configured
    if grep -q "CHANGE-ME-TO-SECURE-TOKEN" base/01-secrets.yaml; then
        warn "Access token not configured. Generating one..."
        generate_access_token
    fi
    
    # Check if domain has been configured
    if grep -q "qlever.example.com" base/06-ingress.yaml && [ "$DOMAIN" != "qlever.example.com" ]; then
        configure_domain
    fi
    
    # Apply all resources
    kubectl apply -k base/
    
    info "✓ QLever deployed"
    info "Waiting for pods to be ready..."
    
    kubectl wait --for=condition=Ready pod \
        -l app=qlever-server \
        -n $NAMESPACE \
        --timeout=600s || warn "QLever pod not ready yet (may still be indexing)"
    
    info "✓ Deployment complete"
}

show_status() {
    info "Checking deployment status..."
    
    echo ""
    echo "=== Caddy Ingress Controller ==="
    kubectl get pods,svc -n $CADDY_NAMESPACE
    
    echo ""
    echo "=== QLever ==="
    kubectl get all -n $NAMESPACE
    
    echo ""
    echo "=== Ingress ==="
    kubectl get ingress -n $NAMESPACE
    
    echo ""
    echo "=== Network Policies ==="
    kubectl get networkpolicies -n $NAMESPACE
    
    echo ""
    info "Access QLever at: https://$DOMAIN"
}

show_logs() {
    info "Tailing QLever logs..."
    kubectl logs -n $NAMESPACE -l app=qlever-server -f --tail=100
}

open_shell() {
    info "Opening shell in QLever pod..."
    kubectl exec -it -n $NAMESPACE deployment/qlever-server -- /bin/bash
}

delete_qlever() {
    warn "Deleting QLever resources..."
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        kubectl delete -k base/
        info "✓ QLever deleted"
    else
        info "Cancelled"
    fi
}

uninstall_all() {
    warn "Uninstalling everything (Caddy + QLever)..."
    read -p "Are you sure? This will delete all resources! (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Delete QLever
        kubectl delete -k base/ || true
        
        # Delete Caddy
        if command -v helm &> /dev/null; then
            helm uninstall mycaddy -n $CADDY_NAMESPACE || true
        fi
        kubectl delete namespace $CADDY_NAMESPACE || true
        
        info "✓ Everything uninstalled"
    else
        info "Cancelled"
    fi
}

# Main command handler
case "${1:-help}" in
    install)
        check_requirements
        install_caddy
        deploy_qlever
        show_status
        ;;
    caddy)
        check_requirements
        install_caddy
        ;;
    qlever)
        check_requirements
        deploy_qlever
        show_status
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    shell)
        open_shell
        ;;
    delete)
        delete_qlever
        ;;
    uninstall)
        uninstall_all
        ;;
    help|*)
        echo "Usage: $0 {install|caddy|qlever|status|logs|shell|delete|uninstall}"
        echo ""
        echo "Commands:"
        echo "  install    - Install Caddy + QLever (full setup)"
        echo "  caddy      - Install Caddy Ingress Controller only"
        echo "  qlever     - Deploy QLever only"
        echo "  status     - Show deployment status"
        echo "  logs       - Tail QLever logs"
        echo "  shell      - Open shell in QLever pod"
        echo "  delete     - Delete QLever resources"
        echo "  uninstall  - Delete everything (Caddy + QLever)"
        echo ""
        echo "Environment variables:"
        echo "  QLEVER_DOMAIN - Domain for Ingress (default: qlever.example.com)"
        echo "  QLEVER_EMAIL  - Email for Let's Encrypt (default: your-email@example.com)"
        echo ""
        echo "Example:"
        echo "  QLEVER_DOMAIN=sparql.mycompany.com QLEVER_EMAIL=admin@mycompany.com ./deploy.sh install"
        exit 0
        ;;
esac