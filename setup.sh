
set -e

CHAIN_ID=${1:-1988}
GAS_TOKEN_ID=${2:-1}

echo ""
echo "=================================================="
echo "   L3 Aleo — Setup do Ambiente de Teste"
echo "  Chain ID    : $CHAIN_ID"
echo "  Gas Token ID: $GAS_TOKEN_ID"
echo "=================================================="
echo ""

# 1. Sobe infraestrutura base (banco + zk prover)
echo " [1/4] Subindo Postgres e ZK Prover..."
docker compose up -d postgres zk_prover
echo "   Aguardando serviços ficarem saudáveis..."
docker compose wait postgres zk_prover 2>/dev/null || sleep 10

# 2. Build e execução do CLI para deploy + spawn_chain
echo ""
echo " [2/4] Buildando imagem do CLI (Leo + Rust — pode demorar na 1ª vez)..."
docker compose --profile cli build cli

echo ""
echo " [3/4] Fazendo deploy do contrato L3 na Aleo Testnet + spawn_chain..."
echo "   (isso usa créditos reais da testnet — certifique-se de ter saldo)"
docker compose --profile cli run --rm cli \
    node cli.mjs full \
    --chain-id "$CHAIN_ID" \
    --gas-token-id "$GAS_TOKEN_ID"

# 3. Sobe os nós L3
echo ""
echo " [4/4] Subindo os nós L3 (node1 + node2)..."
docker compose up -d node1 node2
echo "   Aguardando node1 ficar saudável..."
until docker compose exec node1 wget -qO- http://localhost:8545/health > /dev/null 2>&1; do
    echo "   ...aguardando node1..."
    sleep 5
done

echo ""
echo "=================================================="
echo "   Ambiente de Teste PRONTO!"
echo ""
echo "  RPC node1  → http://localhost:8545"
echo "  RPC node2  → http://localhost:8546"
echo "  ZK Prover  → http://localhost:3030"
echo "  Postgres   → localhost:5432 (l3user/l3pass)"
echo ""
echo "  Para abrir o PgAdmin:"
echo "  docker compose --profile tools up -d pgadmin"
echo "  → http://localhost:5050 (dev@l3.local / l3pass)"
echo ""
echo "  Para parar tudo:   docker compose down"
echo "  Para resetar tudo: docker compose down -v"
echo "=================================================="
