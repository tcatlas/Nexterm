import { DialogProvider } from "@/common/components/Dialog";
import Button from "@/common/components/Button";
import SelectBox from "@/common/components/SelectBox";
import TabSwitcher from "@/common/components/TabSwitcher";
import DetailsPage from "@/pages/Servers/components/ServerDialog/pages/DetailsPage.jsx";
import IdentityPage from "@/pages/Servers/components/ServerDialog/pages/IdentityPage.jsx";
import SettingsPage from "@/pages/Servers/components/ServerDialog/pages/SettingsPage.jsx";
import { getFieldConfig } from "@/pages/Servers/components/ServerDialog/utils/fieldConfig.js";
import { getRequest, patchRequest, putRequest } from "@/common/utils/RequestUtil.js";
import { IdentityContext } from "@/common/contexts/IdentityContext.jsx";
import { ServerContext } from "@/common/contexts/ServerContext.jsx";
import { useToast } from "@/common/contexts/ToastContext.jsx";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { mdiAccountKeyOutline, mdiCogOutline, mdiInformationOutline, mdiContentDuplicate } from "@mdi/js";
import Icon from "@mdi/react";
import "./styles.sass";

const PROTOCOL_OPTIONS = [
    { label: "SSH", value: "ssh" },
    { label: "Telnet", value: "telnet" },
    { label: "RDP", value: "rdp" },
    { label: "VNC", value: "vnc" },
    { label: "SFTP", value: "sftp" },
    { label: "FTP", value: "ftp" },
    { label: "FTPS", value: "ftps" },
];

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const FolderInheritanceDialog = ({ open, onClose, folderId, organizationId }) => {
    const { t } = useTranslation();
    const { loadServers } = useContext(ServerContext);
    const { loadIdentities } = useContext(IdentityContext);
    const { sendToast } = useToast();
    const [profiles, setProfiles] = useState({});
    const [inheritedProfiles, setInheritedProfiles] = useState({});
    const [identityProfiles, setIdentityProfiles] = useState({});
    const [inheritedIdentityProfiles, setInheritedIdentityProfiles] = useState({});
    const [rawConfig, setRawConfig] = useState({});
    const [protocol, setProtocol] = useState("ssh");
    const [identityUpdates, setIdentityUpdates] = useState({});
    const [monitoringEnabled, setMonitoringEnabled] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    const [hasParent, setHasParent] = useState(false);

    const config = profiles[protocol] || {};
    const inheritedConfig = inheritedProfiles[protocol] || {};
    const identities = identityProfiles[protocol] || inheritedIdentityProfiles[protocol] || [];
    const inheritedIdentities = inheritedIdentityProfiles[protocol] || [];
    const fieldConfig = { ...getFieldConfig("server", protocol), showProtocol: false };
    const effectiveConfig = useMemo(() => ({
        ...config,
        ...(fieldConfig.showMonitoring ? { monitoringEnabled } : {}),
    }), [config, fieldConfig.showMonitoring, monitoringEnabled]);
    const localConfig = useMemo(() => Object.fromEntries(Object.entries(effectiveConfig).filter(([key, value]) => !equal(value, inheritedConfig[key]))), [effectiveConfig, inheritedConfig]);
    const overrides = useMemo(() => hasParent ? Object.keys(localConfig) : [], [hasParent, localConfig]);
    const savedInheritance = rawConfig.__nextermInheritance || {};
    const savedProfile = savedInheritance.profiles?.[protocol] || {};
    const savedIdentities = savedInheritance.identityProfiles?.[protocol] || inheritedIdentities;
    const identityOverride = hasParent && !equal(identities, inheritedIdentities);
    const isDirty = !equal(localConfig, savedProfile) || !equal(identities, savedIdentities) || Object.keys(identityUpdates).length > 0;
    const tabs = [
        { key: "details", label: t("servers.dialog.tabs.details"), icon: mdiInformationOutline },
        { key: "identities", label: t("servers.dialog.tabs.identities"), icon: mdiAccountKeyOutline },
        { key: "settings", label: t("servers.dialog.tabs.settings"), icon: mdiCogOutline },
    ];

    const setProfileConfig = (update) => {
        setProfiles((current) => {
            const next = typeof update === "function" ? update(current[protocol] || {}) : update;
            const { protocol: ignoredProtocol, ...profile } = next;
            return { ...current, [protocol]: profile };
        });
    };

    const resetOverride = (key) => {
        const value = inheritedConfig[key];
        setProfileConfig((current) => {
            const next = { ...current };
            if (Object.hasOwn(inheritedConfig, key)) next[key] = value;
            else delete next[key];
            return next;
        });
        if (key === "monitoringEnabled") setMonitoringEnabled(Boolean(value));
    };

    const setProfileIdentities = (update) => {
        setIdentityProfiles((current) => ({
            ...current,
            [protocol]: typeof update === "function" ? update(current[protocol] || inheritedIdentities) : update,
        }));
    };

    const enableIdentityInheritance = () => {
        setIdentityProfiles((current) => {
            const next = { ...current };
            delete next[protocol];
            return next;
        });
    };

    useEffect(() => {
        if (!open || !folderId) return;

        setHasParent(false);
        getRequest(`folders/${folderId}`).then((folder) => {
            const availableProtocols = [...new Set([
                ...Object.keys(folder.profiles || {}),
                ...Object.keys(folder.inheritedProfiles || {}),
                "ssh",
            ])];
            setProfiles(folder.profiles || {});
            setInheritedProfiles(folder.inheritedProfiles || {});
            setIdentityProfiles(folder.identityProfiles || {});
            setInheritedIdentityProfiles(folder.inheritedIdentityProfiles || {});
            setRawConfig(folder.rawConfig || {});
            setHasParent(Boolean(folder.parentId));
            setProtocol(availableProtocols[0]);
            setIdentityUpdates({});
            setActiveTab(0);
        });
    }, [open, folderId]);

    useEffect(() => {
        setMonitoringEnabled(Boolean(config.monitoringEnabled));
    }, [protocol, config.monitoringEnabled]);

    const updateIdentities = async () => {
        const ids = new Set(identities);

        for (const [identityId, identity] of Object.entries(identityUpdates)) {
            const payload = {
                name: identity.name,
                username: identity.authType === "password-only" ? undefined : identity.username,
                type: identity.authType,
                organizationId: identity.organizationId || undefined,
                ...(identity.passwordTouched || identity.password ? { password: identity.password } : {}),
                ...(identity.sshKey ? { sshKey: identity.sshKey } : {}),
                ...(identity.passphraseTouched || identity.passphrase ? { passphrase: identity.passphrase } : {}),
            };
            const result = identityId.startsWith("new-")
                ? await putRequest("identities", payload)
                : await patchRequest(`identities/${identityId}`, payload);
            ids.add(result.id || Number(identityId));
        }

        return [...ids];
    };

    const save = async () => {
        try {
            const identityIds = await updateIdentities();
            const { __nextermInheritance, ...preservedConfig } = rawConfig;
            const inheritance = { ...(__nextermInheritance || {}) };
            const profileSettings = { ...(inheritance.profiles || {}) };
            const profileIdentities = { ...(inheritance.identityProfiles || {}) };

            if (Object.keys(localConfig).length) profileSettings[protocol] = localConfig;
            else delete profileSettings[protocol];

            if (!equal(identityIds, inheritedIdentities)) profileIdentities[protocol] = identityIds;
            else delete profileIdentities[protocol];

            inheritance.profiles = profileSettings;
            inheritance.identityProfiles = profileIdentities;

            await patchRequest(`folders/${folderId}`, {
                config: { ...preservedConfig, __nextermInheritance: inheritance },
            });
            loadIdentities();
            loadServers();
            sendToast("Success", t("servers.messages.serverUpdated"));
            onClose();
        } catch (error) {
            sendToast("Error", error.message || t("servers.messages.updateFailed"));
        }
    };

    return (
        <DialogProvider open={open} onClose={onClose} isDirty={isDirty}>
            <div className="server-dialog folder-inheritance-dialog">
                <div className="server-dialog-header">
                    <div className="dialog-icon"><Icon path={mdiContentDuplicate} size={1} /></div>
                    <div className="server-dialog-title"><h2>{t("servers.contextMenu.inheritanceSettings", "Inheritance settings")}</h2></div>
                </div>
                <div className="form-group profile-select">
                    <label>{t("servers.dialog.fields.protocol")}</label>
                    <SelectBox options={PROTOCOL_OPTIONS} selected={protocol} setSelected={setProtocol} />
                </div>                <div className="server-dialog-tabs">
                    <TabSwitcher tabs={tabs.map((tab, index) => ({ ...tab, key: String(index) }))} activeTab={String(activeTab)} onTabChange={(tab) => setActiveTab(Number(tab))} variant="dialog" />
                </div>
                <form className="server-dialog-content" onSubmit={(event) => event.preventDefault()}>
                    {activeTab === 0 && <DetailsPage config={config} setConfig={setProfileConfig} fieldConfig={fieldConfig} showNameIcon={false} overrides={overrides} onReset={resetOverride} inheritedConfig={inheritedConfig} />}
                    {activeTab === 1 && <IdentityPage serverIdentities={identities} setIdentityUpdates={setIdentityUpdates} identityUpdates={identityUpdates} setIdentities={setProfileIdentities} currentOrganizationId={organizationId} allowedAuthTypes={fieldConfig.allowedAuthTypes} serverName="" inheritedIdentities={inheritedIdentities} identityOverride={identityOverride} onEnableInheritance={enableIdentityInheritance} canEnableInheritance={hasParent} />}
                    {activeTab === 2 && <SettingsPage config={{ ...config, protocol }} setConfig={setProfileConfig} monitoringEnabled={monitoringEnabled} setMonitoringEnabled={setMonitoringEnabled} fieldConfig={fieldConfig} editServerId={null} overrides={overrides} onReset={resetOverride} inheritedConfig={inheritedConfig} />}
                </form>
                <Button className="server-dialog-button" onClick={save} text={t("servers.dialog.actions.save")} />
            </div>
        </DialogProvider>
    );
};

export default FolderInheritanceDialog;
