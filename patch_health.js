import fs from 'fs';

let content = fs.readFileSync('services/whatsappHealthManager.ts', 'utf8');

const target = `    } catch (err: any) {
      console.error(\`[WhatsappHealthManager] Error checking \${instanceName}:\`, err.message);
      await this.handleStatusChange(storeId, instanceName, "DISCONNECTED", previousState, err.message);
    }`;

const replacement = `    } catch (err: any) {
      console.error(\`[WhatsappHealthManager] Error checking \${instanceName}:\`, err.message);
      
      const health = this.healthMap.get(storeId);
      const failures = (health?.consecutiveFailures || 0) + 1;
      
      if (failures >= 3) {
        await this.handleStatusChange(storeId, instanceName, "DISCONNECTED", previousState, err.message);
      } else {
        // Guardar a falha transiente sem mudar o status
        this.healthMap.set(storeId, {
          storeId,
          instanceName,
          status: previousState as any,
          lastCheckAt: new Date().toISOString(),
          consecutiveFailures: failures,
        });
        console.warn(\`[WhatsappHealthManager] Transient fetch error for \${instanceName}. Failure \${failures}/3\`);
      }
    }`;

content = content.replace(target, replacement);
fs.writeFileSync('services/whatsappHealthManager.ts', content);
