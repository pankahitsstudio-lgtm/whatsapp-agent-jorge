# WhatsApp Agent - Jorge Dimas
Bot pessoal do Jorge rodando com Baileys + Claude AI no Railway.

## Como funciona
- Conecta ao WhatsApp via Baileys (mesma engine do WhatsApp Web)
- Toda mensagem de texto recebida vai pro Claude com contexto do Jorge
- Claude responde como o Jorge, com delay humano simulado
- Voce pode pausar/retomar o bot por conversa com comandos

## Comandos (voce envia na conversa)
| Comando | Efeito |
|---------|--------|
| `!manual` | Pausa o bot naquela conversa (voce assume) |
| `!bot` | Reativa o bot naquela conversa |

## Setup local (para testar)

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variaveis
cp .env.example .env
# Edite o .env com sua ANTHROPIC_API_KEY

# 3. Rodar
npm start
# Escaneia o QR Code que aparecer no terminal
```

## Deploy no Railway

### 1. Criar repositorio no GitHub
```bash
git init
git add .
git commit -m "feat: whatsapp agent jorge"
git remote add origin https://github.com/SEU_USER/whatsapp-agent.git
git push -u origin main
```

### 2. Criar servico no Railway
- New Project > Deploy from GitHub > selecionar o repo
- Add Variable: `ANTHROPIC_API_KEY` = sua chave
- Add Variable: `BLOCKED_NUMBERS` = numeros importantes (ex: 5512999999999)

### 3. Volume para persistir a sessao
No Railway: seu servico > Volumes > Add Volume
- Mount Path: `/app/auth_info`
- Sem isso, toda vez que reiniciar pede QR code de novo

### 4. Ver QR Code no Railway
- Vá em seu servico > Deployments > logs do deploy atual
- O QR Code vai aparecer nos logs
- Escaneia pelo celular: WhatsApp > Dispositivos Vinculados > +

## Variaveis de ambiente

| Variavel | Descricao | Padrao |
|----------|-----------|--------|
| `ANTHROPIC_API_KEY` | Chave da API do Claude | obrigatorio |
| `BLOCKED_NUMBERS` | Numeros que o bot ignora (virgula) | vazio |
| `MANUAL_PREFIX` | Prefixo para pausar o bot | `!manual` |
| `BOT_PREFIX` | Prefixo para retomar o bot | `!bot` |

## Aviso
Baileys usa engenharia reversa do WhatsApp Web.
Use com moderacao para evitar ban do numero.
Recomendado usar um chip secundario ou chip de testes primeiro.
