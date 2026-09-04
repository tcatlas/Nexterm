const Folder = require("../models/Folder");
const EntryIdentity = require("../models/EntryIdentity");

const INHERITANCE_KEY = "__nextermInheritance";

const withoutInheritance = (config) => {
    const { [INHERITANCE_KEY]: inheritance, ...settings } = config || {};
    return settings;
};

const getFolderLineage = async (folderId) => {
    const lineage = [];
    let currentFolderId = folderId;

    while (currentFolderId) {
        const folder = await Folder.findByPk(currentFolderId);
        if (!folder) break;
        lineage.unshift(folder);
        currentFolderId = folder.parentId;
    }

    return lineage;
};

const getFolderInheritance = async (folderId, protocol = null) => {
    const lineage = await getFolderLineage(folderId);
    let sharedConfig = {};
    let sharedIdentities;
    const profiles = {};
    const identityProfiles = {};

    for (const folder of lineage) {
        const inheritance = folder.config?.[INHERITANCE_KEY];
        if (!inheritance) continue;
        const legacyProtocol = inheritance.config?.protocol;
        const { protocol: ignoredProtocol, ...legacyConfig } = inheritance.config || {};

        if (legacyProtocol) {
            profiles[legacyProtocol] = { ...profiles[legacyProtocol], ...legacyConfig };
            if (Object.hasOwn(inheritance, "identities")) identityProfiles[legacyProtocol] = inheritance.identities;
        } else {
            sharedConfig = { ...sharedConfig, ...legacyConfig };
            if (Object.hasOwn(inheritance, "identities")) sharedIdentities = inheritance.identities;
        }

        for (const [profileProtocol, profileConfig] of Object.entries(inheritance.profiles || {})) {
            profiles[profileProtocol] = { ...profiles[profileProtocol], ...profileConfig };
        }

        for (const [profileProtocol, profileIdentities] of Object.entries(inheritance.identityProfiles || {})) {
            identityProfiles[profileProtocol] = profileIdentities;
        }
    }

    if (!protocol) {
        return {
            config: sharedConfig,
            identities: sharedIdentities || [],
            profiles,
            identityProfiles,
        };
    }

    return {
        config: { ...sharedConfig, ...(profiles[protocol] || {}) },
        identities: identityProfiles[protocol] || sharedIdentities || [],
        profiles,
        identityProfiles,
    };
};

const getParentFolderInheritance = async (folderId) => {
    const folder = await Folder.findByPk(folderId);
    return folder?.parentId ? getFolderInheritance(folder.parentId) : { config: {}, identities: [] };
};

const getEffectiveEntryConfig = async (entry) => {
    const config = withoutInheritance(entry.config);
    const inheritance = entry.folderId ? await getFolderInheritance(entry.folderId, config.protocol) : { config: {} };
    return { ...inheritance.config, ...config };
};

const getEntryIdentityIds = async (entry) => {
    const directIdentities = await EntryIdentity.findAll({
        where: { entryId: entry.id },
        order: [["isDefault", "DESC"]]
    });
    const directIds = directIdentities.map((identity) => identity.identityId);

    if (!entry.folderId) return directIds;

    const inheritedIds = (await getFolderInheritance(entry.folderId, withoutInheritance(entry.config).protocol)).identities;
    return [...directIds, ...inheritedIds.filter((identityId) => !directIds.includes(identityId))];
};

module.exports = {
    INHERITANCE_KEY,
    withoutInheritance,
    getFolderInheritance,
    getParentFolderInheritance,
    getEffectiveEntryConfig,
    getEntryIdentityIds,
};
