import { Express } from 'express';

const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'NexoIA ERP/PDV Integration API',
    version: '1.0.0',
    description: 'API para integração em tempo real entre sistemas ERP/PDV de farmácias e a plataforma NexoIA.',
  },
  servers: [
    {
      url: '/api/v1/integration',
      description: 'Integration API',
    },
    {
      url: '/api/v1',
      description: 'Webhook API',
    }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Token de Integração exclusivo da farmácia (integration_token)',
      },
    },
  },
  security: [
    {
      ApiKeyAuth: [],
    },
  ],
  paths: {
    '/sale': {
      post: {
        summary: 'Webhook de Baixa de Estoque (Venda no Balcão)',
        description: 'Subtrai a quantidade vendida do estoque da loja online. Se o estoque chegar a zero, o produto é ocultado da vitrine principal.',
        tags: ['Vendas'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['quantity'],
                properties: {
                  ean: { type: 'string', description: 'Código de barras (EAN) do produto' },
                  internalCode: { type: 'string', description: 'Código interno do produto no ERP' },
                  quantity: { type: 'number', description: 'Quantidade vendida' },
                  transactionId: { type: 'string', description: 'ID transacional exclusivo da venda/cupom gerado pelo ERP. Usado como trava de segurança (idempotência) para evitar baixas duplicadas de estoque caso a rede oscile.' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Estoque atualizado com sucesso' },
          '400': { description: 'EAN ou Código Interno não fornecido' },
          '404': { description: 'Produto não encontrado' }
        }
      }
    },
    '/purchase': {
      post: {
        summary: 'Sincronização de Entrada de Mercadoria (Notas Fiscais)',
        description: 'Soma a quantidade de entrada ao saldo atual. Atualiza preços se necessário. Cria rascunho se o produto for novo.',
        tags: ['Compras'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ean', 'quantity', 'costPrice'],
                properties: {
                  ean: { type: 'string' },
                  internalCode: { type: 'string' },
                  name: { type: 'string' },
                  quantity: { type: 'number' },
                  costPrice: { type: 'number' },
                  salePrice: { type: 'number' }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Estoque/Preço atualizado ou produto criado' }
        }
      }
    },
    '/sync/inventory': {
      post: {
        summary: 'Webhook Unificado para Sincronização de Vendas e Estoque',
        description: 'Recebe dados do sistema da farmácia (ERP) para realizar a baixa de estoque automática (SALE) e a atualização de entradas de mercadoria (PURCHASE).',
        tags: ['Integração'],
        parameters: [
          {
            in: 'query',
            name: 'token',
            schema: { type: 'string' },
            required: true,
            description: 'Token de integração vinculado ao CNPJ da farmácia'
          },
          {
            in: 'query',
            name: 'tenant_id',
            schema: { type: 'string' },
            required: false,
            description: 'ID do Tenant (opcional se o token for único)'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type'],
                properties: {
                  type: { type: 'string', enum: ['SALE', 'PURCHASE'], description: 'Tipo de operação' },
                  ean: { type: 'string', description: 'Código de barras (EAN)' },
                  internalCode: { type: 'string', description: 'Código interno no ERP' },
                  quantity: { type: 'number', description: 'Quantidade vendida ou comprada' },
                  price_sale: { type: 'number' }
                }
              }
            }
          }
        },
        responses: {
          '202': { description: 'Sincronização aceita e enviada para processamento em background' },
          '400': { description: 'Dados inválidos' },
          '401': { description: 'Token inválido' },
          '404': { description: 'Produto não encontrado' }
        }
      }
    }
  }
};

export const setupSwagger = (app: Express) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Swagger UI</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.css" />
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js" crossorigin></script>
<script>
  window.onload = () => {
    window.ui = SwaggerUIBundle({
      spec: ${JSON.stringify(swaggerDocument)},
      dom_id: '#swagger-ui',
    });
  };
</script>
</body>
</html>
  `;
  
  app.get(['/api-docs', '/api-docs/'], (req, res) => {
    res.send(html);
  });
};
