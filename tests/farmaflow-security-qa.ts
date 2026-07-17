/**
 * FarmaFlow.online (nexoIa) - QA and Security Testing Suite
 * This suite provides production-ready implementations, integration tests, 
 * sanitization unit tests, and custom hooks to secure physical and logical assets.
 */

import { useState, useEffect } from 'react';

// =========================================================================
// 1. ISOLAMENTO DE TENANT (IDOR) - SIMULADOR & TESTES DE API
// =========================================================================

export interface RequestPayload {
    id: string;
    name: string;
    price: number;
    tenant_id: string; // Target Company ID
}

export interface UserSession {
    userId: string;
    tenantId: string;
    role: 'SUPER_ADMIN' | 'PHARMACY_ADMIN' | 'GUEST';
}

/**
 * Server Middleware Scenario for Tenant Isolation.
 * Validates if the authenticated admin has permissions to access/modify the requested tenant.
 */
export function authorizeTenantAccess(session: UserSession, targetTenantId: string): { authorized: boolean; statusCode: number; message: string } {
    if (!session) {
        return { authorized: false, statusCode: 401, message: 'Não autorizado. Sessão inválida ou inexistente.' };
    }

    // Super Admin can access any tenant resources
    if (session.role === 'SUPER_ADMIN') {
        return { authorized: true, statusCode: 200, message: 'Acesso concedido (Super Admin).' };
    }

    // Pharmacy Admin can ONLY access their own tenant
    if (session.role === 'PHARMACY_ADMIN') {
        if (session.tenantId !== targetTenantId) {
            return {
                authorized: false,
                statusCode: 403,
                message: `Tentativa ilegal de IDOR detectada: Drogaria '${session.tenantId}' tentou acessar recursos da Drogaria '${targetTenantId}'.`
            };
        }
        return { authorized: true, statusCode: 200, message: 'Acesso concedido (Proprietário do Tenant).' };
    }

    return { authorized: false, statusCode: 403, message: 'Permissão insuficiente para esta operação.' };
}

/**
 * Automated Mock Integration Test Suite for IDOR detection.
 * Simulates API PUT/POST requests.
 */
export async function runIdorIntegrationTest() {
    console.log('\n=== [SUPERTEST SIMULATOR] INICIANDO TESTE DE ISOLAMENTO DE TENANT (IDOR) ===');

    // Scenario A: Drogaria A (Legit) tries to modify products containing its own tenant_id
    const sessionDrogariaA: UserSession = {
        userId: 'usr_abc123',
        tenantId: 'drogaria_a_id',
        role: 'PHARMACY_ADMIN'
    };

    const legitimatePayload: RequestPayload = {
        id: 'prod_999',
        name: 'Aspirina 500mg C/ 10 Tab',
        price: 15.90,
        tenant_id: 'drogaria_a_id'
    };

    const legitCheck = authorizeTenantAccess(sessionDrogariaA, legitimatePayload.tenant_id);
    console.log(`[TESTE legitCheck] Status de Retorno Esperado: 200. Obtido: ${legitCheck.statusCode}`);
    console.log(`[TESTE legitCheck] Mensagem: ${legitCheck.message}`);
    const isLegitSuccess = legitCheck.statusCode === 200;

    // Scenario B: Drogaria A (Hostile Agent) attempts to hijack Drogaria B resources
    const maliciousPayload: RequestPayload = {
        id: 'prod_777',
        name: 'Rivotril Modificado Ilegalmente',
        price: 1.00,
        tenant_id: 'drogaria_b_id' // Spoofed Tenant ID
    };

    const attackCheck = authorizeTenantAccess(sessionDrogariaA, maliciousPayload.tenant_id);
    console.log(`[TESTE attackCheck] Status de Retorno Esperado: 403. Obtido: ${attackCheck.statusCode}`);
    console.log(`[TESTE attackCheck] Mensagem: ${attackCheck.message}`);
    const isAttackBlocked = attackCheck.statusCode === 403;

    // Scenario C: Super Admin updates product registry for global inventory or custom bulk sync
    const sessionSuper: UserSession = {
        userId: 'usr_admin',
        tenantId: 'farmaflow_core',
        role: 'SUPER_ADMIN'
    };

    const superCheck = authorizeTenantAccess(sessionSuper, 'drogaria_b_id');
    console.log(`[TESTE superCheck] Status de Retorno Esperado: 200. Obtido: ${superCheck.statusCode}`);
    const isSuperSuccess = superCheck.statusCode === 200;

    const allPassed = isLegitSuccess && isAttackBlocked && isSuperSuccess;
    console.log(`\n>>> RESULTADO DOS TESTES DE IDOR: ${allPassed ? '✅ TODOS PASSARAM (SISTEMA SEGURO)' : '❌ FALHA DETECTADA'}\n`);
    
    return allPassed;
}


// =========================================================================
// 2. PARSER DE PLANILHAS COM HIGIENIZAÇÃO (ANTI-SPREADSHEET INJECTION)
// =========================================================================

/**
 * Strict Input Sanitization helper to protect against Formula / CSV Injection.
 * Prepends a single quote to prevent execution of expressions starting with =, +, -, @, or tab characters.
 * Gracefully handles nulls, undefined values, and structural overflows.
 */
export function sanitizarValoresImportacao(rawValue: any): string {
    if (rawValue === null || rawValue === undefined) {
        return '';
    }

    let cleanStr = String(rawValue).trim();
    if (cleanStr.length === 0) {
        return '';
    }

    // Formula Injection signature elements characters
    const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
    const startsDangerous = dangerousPrefixes.some(prefix => cleanStr.startsWith(prefix));

    if (startsDangerous) {
        // Safe conversion into flat text, escaping evaluation engines
        cleanStr = `'${cleanStr}`;
    }

    return cleanStr;
}

/**
 * Suite to test parsing logic of corrupt, malicious, and nested row templates.
 */
export async function runSpreadsheetSanitizerTest() {
    console.log('=== [UNIT TEST] INICIANDO HIGIENIZAÇÃO DE VALORES E ENTRADAS CORROMPIDAS ===');

    const corruptRows = [
        { rowNumber: 1, name: '=A1+B1', price: '45.00', category: 'Vitaminas' }, // Injection attack
        { rowNumber: 2, name: '+PROMO_MEDS', price: '12.50', category: 'Medicamentos' }, // Attack
        { rowNumber: 3, name: '@system_admin_hook', price: '99.90', category: 'Cosméticos' }, // System command injection
        { rowNumber: 4, name: null, price: undefined, category: 'Outros' }, // Null values tests
        { rowNumber: 5, name: 'Normal Paracetamol', price: '5.40', category: 'Medicamentos' } // Legitimate entry
    ];

    let successCount = 0;

    for (const row of corruptRows) {
        try {
            const cleanName = sanitizarValoresImportacao(row.name);
            const cleanPrice = sanitizarValoresImportacao(row.price);
            const cleanCategory = sanitizarValoresImportacao(row.category);

            console.log(`[Linha ${row.rowNumber}] Processamento Concluído.`);
            console.log(`   🔸 Nome original: [${row.name}] -> Higienizado: [${cleanName}]`);

            // Assertions
            if (row.rowNumber === 1 && cleanName !== `'=A1+B1`) throw new Error('Falhou na sanitização do "="');
            if (row.rowNumber === 2 && cleanName !== `'+PROMO_MEDS`) throw new Error('Falhou na sanitização do "+"');
            if (row.rowNumber === 3 && cleanName !== `'@system_admin_hook`) throw new Error('Falhou na sanitização do "@"');
            if (row.rowNumber === 4 && (cleanName !== '' || cleanPrice !== '')) throw new Error('Unhandled exception para nulos');
            if (row.rowNumber === 5 && cleanName !== 'Normal Paracetamol') throw new Error('Normal text corrupted');

            successCount++;
        } catch (error: any) {
            console.error(`❌ Erro no Processamento da Linha ${row.rowNumber}: ${error.message}`);
        }
    }

    const isSanitationSecure = successCount === corruptRows.length;
    console.log(`\n>>> RESULTADO DOS TESTES DO PARSER DE PLANILHAS: ${isSanitationSecure ? '✅ TODOS PASSARAM (SEGURO)' : '❌ TESTES FALHARAM'}\n`);
    
    return isSanitationSecure;
}


// =========================================================================
// 3. FRONTEND STATE LEAKING PREVENTION (RESET DE ESTADO - CLEANUP HOOK)
// =========================================================================

/**
 * Clean UI State React hook
 * Ensures old state from previous organization is wiped thoroughly.
 */
export function useTenantStateCleanup(
    currentTenantId: string | undefined,
    stateResets: {
        setProducts: (data: any[]) => void;
        setOrders: (data: any[]) => void;
        setPromotions: (data: any[]) => void;
        setCoupons: (data: any[]) => void;
        setCart: (data: any[]) => void;
        setIsLoading: (loading: boolean) => void;
    }
) {
    useEffect(() => {
        if (!currentTenantId) return;

        // --- DISPATCH ISOLATED CLEANUP INSTANTLY ---
        console.log(`%c[FarmaFlow State Engine] Alternância de Tenant detectada (Novo ID: ${currentTenantId}). Executando reset total de buffers!`, 'color: #3b82f6; font-weight: bold;');
        
        // Block leaks instantly
        stateResets.setIsLoading(true);
        stateResets.setProducts([]);
        stateResets.setOrders([]);
        stateResets.setPromotions([]);
        stateResets.setCoupons([]);
        stateResets.setCart([]); // Clear pending carts to avoid mixing cross-store acquisitions
        
        // Emulators will pull the new database credentials after this microtask clears

    }, [currentTenantId]);
}


// =========================================================================
// 4. MAIN EXECUTOR (FOR DEV & INTEGRATION FLOWS)
// =========================================================================

export async function runFullAppSecAndQaDiagnostics() {
    console.log('🏁 INICIANDO DIAGNÓSTICO GERAL DE TESTES E APPSEC...');
    const idorSuccess = await runIdorIntegrationTest();
    const sanitizerSuccess = await runSpreadsheetSanitizerTest();
    
    if (idorSuccess && sanitizerSuccess) {
        console.log('🚀FarmeFlow.online está pronto para homologação e auditoria final de produção!');
    } else {
        console.warn('⚠️ Diagnóstico de testes falhou. Favor revisar os tratamentos de exceção.');
    }
}
