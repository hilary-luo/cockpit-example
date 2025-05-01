/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React, { useEffect, useState, useRef } from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Card, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page";
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { ClipboardCopyButton } from "@patternfly/react-core/dist/esm/components/ClipboardCopy";
import { CodeBlock, CodeBlockAction, CodeBlockCode, TreeView } from '@patternfly/react-core';
import { ExpandableSection, ExpandableSectionToggle } from '@patternfly/react-core/dist/esm/components/ExpandableSection';

import { CodeEditor, Language } from '@patternfly/react-code-editor';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox';

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

// import { setDiagnosticsOptions } from 'monaco-yaml';

// setDiagnosticsOptions({
//   enableSchemaRequest: true,
//   hover: true,
//   completion: true,
//   validate: true,
//   format: true,
//   schemas: []
// });

import cockpit from 'cockpit';

import { Table, Thead, Tbody } from '@patternfly/react-table';

import { FoxgloveClient, SubscriptionId } from "@foxglove/ws-protocol";

import { Spinner } from "@patternfly/react-core"; // Import Spinner component

import { Ros } from "./Ros";
import { Topic } from "./Topic";

loader.config({ monaco });

const _ = cockpit.gettext; // Ensure cockpit.gettext is used for translations

export const Application = () => {
    useEffect(() => {
        // Initialize the translation system and ensure it updates dynamically
        cockpit.locale((locale) => {
            console.log(_("Locale updated to:"), locale); // Log the updated locale
        });
    }, []);

    const [hostname, setHostname] = useState(_("Unknown"));
    const [namespace, setNamespace] = useState(_("default_namespace")); // Default namespace
    const [yaml, setYaml] = useState(_("Unknown"));
    const [diagnostics, setDiagnostics] = useState([]);
    const [isSaving, setIsSaving] = useState(false); // State to track save button status
    const [isDarkTheme, setIsDarkTheme] = React.useState(false);
    const [isMinimapVisible, setIsMinimapVisible] = React.useState(false);
    const [url, setUrl] = useState<string>("ws://localhost:8765");

    useEffect(() => {
        const hostname = cockpit.file('/etc/hostname');
        hostname.watch(content => setHostname(content?.trim() ?? _("Unknown")));
        return hostname.close;
    }, []);

    useEffect(() => {
        const yamlFile = cockpit.file('/etc/clearpath/robot.yaml');

        const updateYamlContent = (content) => {
            if (content) {
                const trimmedContent = content.trim();
                setYaml(trimmedContent); // Set the full YAML content for the Code Editor

                // Extract namespace or serial_number, ensuring serial_number has no leading white spaces
                const namespaceMatch = trimmedContent.match(/^\s*namespace:\s*(\S+)/m);
                const serialNumberMatch = trimmedContent.match(/^serial_number:\s*(\S+)/m); // No leading white spaces for serial_number
                if (namespaceMatch) {
                    setNamespace(namespaceMatch[1]);
                } else if (serialNumberMatch) {
                    setNamespace(serialNumberMatch[1].replace(/-/g, "_")); // Replace dashes with underscores
                } else {
                    console.warn(_("Neither namespace nor serial_number found in robot.yaml"));
                }
            } else {
                setYaml(_("Unknown")); // Fallback if content is empty or null
            }
        };

        yamlFile.read().then(updateYamlContent)
                .catch(error => {
                    console.error(_("Failed to read robot.yaml:"), error);
                    setYaml(_("Unknown")); // Fallback in case of an error
                });

        yamlFile.watch(updateYamlContent);

        return () => yamlFile.close();
    }, []);

    useEffect(() => {
        if (namespace === _("default_namespace") || !url) {
            console.warn("Namespace or URL is not set. Skipping WebSocket configuration.");
            return;
        }

        const ros = new Ros({ url });

        ros.on('connection', () => {
            console.log('Connected to Foxglove bridge');
        });

        ros.on('error', (error) => {
            console.error('Error connecting to Foxglove bridge:', error);
        });

        ros.on('close', () => {
            console.log('Connection to Foxglove bridge closed');
        });


        const diagnosticsTopic = new Topic({
            ros: ros,
            name: `/${namespace}/diagnostics_agg`,
            messageType: "diagnostic_msgs/DiagnosticArray",
        });

        diagnosticsTopic.subscribe((message) => {
            if (Array.isArray(message.status)) {
                const formattedDiagnostics = message.status.map(({ name = 'N/A', message = 'N/A', level }) => ({
                    name,
                    message,
                    level: level !== undefined ? level.toString() : 'N/A'
                }));
                setDiagnostics(formattedDiagnostics);
            } else {
                console.warn('Unexpected diagnostics data format:', message);
            }
        });

        return () => {
            diagnosticsTopic.unsubscribe();
            ros.close();
        };
    }, [namespace, url]); // Re-run effect when namespace or url changes

    // Code Editor copied and pasted from Patternfly

    const toggleDarkTheme = (checked) => {
        setIsDarkTheme(checked);
    };

    const toggleMinimap = (checked) => {
        setIsMinimapVisible(checked);
    };

    const onEditorDidMount = (editor, monaco) => {
        editor.layout();
        editor.focus();
        monaco.editor.getModels()[0].updateOptions({ tabSize: 5 });
    };

    const onChange = (value) => {
        console.log(value); // eslint-disable-line no-console
    };

    const saveYaml = () => {
        setIsSaving(true); // Set saving state
        const yamlFile = cockpit.file('/etc/clearpath/robot.yaml');

        const saveStartTime = Date.now(); // Track when saving starts

        yamlFile.replace(yaml)
            .then(() => {
                console.log(_("robot.yaml saved successfully"));
            })
            .catch((error) => {
                console.error(_("Failed to save robot.yaml:"), error);
            })
            .finally(() => {
                const elapsedTime = Date.now() - saveStartTime;
                const remainingTime = Math.max(500 - elapsedTime, 0); // Ensure a minimum duration of 500ms
                setTimeout(() => setIsSaving(false), remainingTime);
            });
    };

    const buildTree = (diagnostics) => {
        const tree = {};

        diagnostics.forEach((status) => {
            const parts = status.name.split('/');
            let current = tree;

            parts.forEach((part, index) => {
                if (!current[part]) {
                    current[part] = {
                        name: part,
                        children: {},
                        data: null
                    };
                }
                if (index === parts.length - 1) {
                    current[part].data = status;
                }
                current = current[part].children;
            });
        });

        const convertToTreeView = (node) => {
            return Object.values(node).map((item) => {
                const children = convertToTreeView(item.children);
                return {
                    name: item.name,
                    message: item.data?.message || 'N/A',
                    level: item.data?.level || 'N/A',
                    children
                };
            });
        };

        return convertToTreeView(tree);
    };

    const renderTreeWithColumns = (treeData) => {
        const renderNode = (node, level = 0) => (
            <React.Fragment key={node.name}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginLeft: `${level * 20}px`, alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        {node.level === '2' && <span style={{ color: 'red', marginRight: '8px' }}>⛔</span>}
                        {node.level === '3' && <span style={{ color: 'orange', marginRight: '8px' }}>⏳</span>}
                        {node.level === '1' && <span style={{ color: 'yellow', marginRight: '8px' }}>⚠️</span>}
                        {node.level === '0' && <span style={{ color: 'green', marginRight: '8px' }}>✅</span>}
                        {node.name}
                    </span>
                    <span>{node.message}</span>
                </div>
                {node.children && node.children.map((child) => renderNode(child, level + 1))}
            </React.Fragment>
        );

        return (
            <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: '5px', marginBottom: '10px' }}>
                    <span>{_("Name")}</span>
                    <span>{_("Message")}</span>
                </div>
                {treeData.map((node) => renderNode(node))}
            </div>
        );
    };

    const treeData = diagnostics.length > 0 ? buildTree(diagnostics) : [];

    const renderTable = (title, levelFilter, symbol, color, alertVariant) => (
        <Alert variant={alertVariant} isInline title={title} style={{ margin: '16px 0' }}>
            {diagnostics.filter((status) => {
                const isBottomLevel = !diagnostics.some((other) => other.name.startsWith(`${status.name}/`));
                return isBottomLevel && levelFilter.includes(status.level);
            }).length > 0
                ? (
                    <Table aria-label={title} style={{ width: '100%' }}>
                        <Thead>
                            <tr>
                                <th style={{ width: '50%' }}>{_("Name")}</th>
                                <th style={{ width: '50%' }}>{_("Message")}</th>
                            </tr>
                        </Thead>
                        <Tbody>
                            {diagnostics.filter((status) => {
                                const isBottomLevel = !diagnostics.some((other) => other.name.startsWith(`${status.name}/`));
                                return isBottomLevel && levelFilter.includes(status.level);
                            }).map((status, index) => (
                                <tr key={index}>
                                    <td style={{ display: 'flex', alignItems: 'center', padding: '8px' }}>
                                        <span style={{ color, marginRight: '8px' }}>{symbol}</span>
                                        {status.name || _("N/A")}
                                    </td>
                                    <td style={{ padding: '8px' }}>{status.message || _("N/A")}</td>
                                </tr>
                            ))}
                        </Tbody>
                    </Table>
                )
                : (
                    <p style={{ margin: '8px 0', color: '#666' }}>{_("No data available.")}</p>
                )}
        </Alert>
    );

    return (
        <Page>
            <Card>
                <CardTitle>{_("robot.yaml editable")}</CardTitle>
                <CardBody>
                    <Checkbox
                        label={_("Dark theme")}
                        isChecked={isDarkTheme}
                        onChange={(_event, checked) => setIsDarkTheme(checked)}
                        aria-label={_("dark theme checkbox")}
                        id="toggle-theme"
                        name="toggle-theme"
                    />
                    <Checkbox
                        label={_("Minimap")}
                        isChecked={isMinimapVisible}
                        onChange={(_event, checked) => setIsMinimapVisible(checked)}
                        aria-label={_("display minimap checkbox")}
                        id="toggle-minimap"
                        name="toggle-minimap"
                    />
                    <CodeEditor
                        isDarkTheme={isDarkTheme}
                        isLineNumbersVisible
                        isMinimapVisible={isMinimapVisible}
                        isLanguageLabelVisible
                        code={yaml}
                        onChange={setYaml}
                        language={Language.yaml}
                        onEditorDidMount={onEditorDidMount}
                        height="400px"
                    />
                    <Button
                        variant="primary"
                        onClick={saveYaml}
                        isDisabled={isSaving} // Disable button while saving
                        style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        {isSaving && <Spinner size="md" />} {/* Show spinner while saving */}
                        {isSaving ? _("Saving...") : _("Save")}
                    </Button>
                </CardBody>
            </Card>

            <Card>
                <CardTitle>{_("Errors and Warnings")}</CardTitle>
                <CardBody>
                    {renderTable(_("Errors"), ['2'], '⛔', '#d9534f', 'danger')}
                    {renderTable(_("Stale Diagnostics"), ['3'], '⏳', 'orange', 'info')}
                    {renderTable(_("Warnings"), ['1'], '⚠️', 'yellow', 'warning')}
                </CardBody>
            </Card>

            <Card>
                <CardTitle>{_("Diagnostics Monitor")}</CardTitle>
                <CardBody>
                    {treeData.length > 0
                        ? (
                            renderTreeWithColumns(treeData)
                        )
                        : (
                            <p>{_("No diagnostics data available.")}</p>
                        )}
                </CardBody>
            </Card>
        </Page>
    );
};
