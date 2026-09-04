const Identity = require('../models/Identity');
const { listIdentities } = require("../controllers/identity");
const { getEffectiveEntryConfig, getEntryIdentityIds } = require("./folderInheritance");

const CREDENTIALLESS_PROTOCOLS = ['telnet', 'demo'];

const resolveIdentity = async (entry, identityId, directIdentity = null, accountId = null) => {
    const config = await getEffectiveEntryConfig(entry);
    const protocol = entry.type === "server" ? config.protocol : entry.type;
    const requiresIdentity = !entry.type?.startsWith('pve-') && !CREDENTIALLESS_PROTOCOLS.includes(protocol);

    if (directIdentity) {
        return {
            id: null,
            name: 'Direct Connection',
            username: directIdentity.username,
            type: directIdentity.type,
            isDirect: true,
            directCredentials: {
                password: directIdentity.password,
                "ssh-key": directIdentity.sshKey,
                passphrase: directIdentity.passphrase
            }
        };
    }

    const accessibleIds = accountId ? new Set((await listIdentities(accountId)).map(i => i.id)) : null;

    if (identityId) {
        const identity = await Identity.findByPk(identityId);
        if (!identity) return { identity: null, requiresIdentity };
        if (accessibleIds && !accessibleIds.has(identity.id)) {
            return { identity: null, requiresIdentity, accessDenied: true };
        }
        return identity;
    }

    const entryIdentityIds = await getEntryIdentityIds(entry);

    for (const entryIdentityId of entryIdentityIds) {
        if (accessibleIds && !accessibleIds.has(entryIdentityId)) continue;
        const identity = await Identity.findByPk(entryIdentityId);
        if (identity) return identity;
    }

    return { identity: null, requiresIdentity };
};

module.exports = { resolveIdentity };
