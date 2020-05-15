// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import { notebook } from 'vscode';
import { IExtensionSingleActivationService } from '../../activation/types';
import { ICommandManager } from '../../common/application/types';
import { NativeNotebook } from '../../common/experimentGroups';
import { IFileSystem } from '../../common/platform/types';
import { IDisposableRegistry, IExperimentsManager, IExtensionContext } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { NotebookContentProvider } from './contentProvider';
import { NotebookKernel } from './notebookKernel';
import { NotebookOutputRenderer } from './renderer';

@injectable()
export class NotebookIntegration implements IExtensionSingleActivationService {
    constructor(
        @inject(IExperimentsManager) private readonly experiment: IExperimentsManager,
        @inject(IDisposableRegistry) private readonly disposables: IDisposableRegistry,
        @inject(NotebookContentProvider) private readonly notebookContentProvider: NotebookContentProvider,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(ICommandManager) private readonly commandManager: ICommandManager,
        @inject(NotebookOutputRenderer) private readonly renderer: NotebookOutputRenderer,
        @inject(NotebookKernel) private readonly notebookKernel: NotebookKernel
    ) {}
    public async activate(): Promise<void> {
        if (!this.experiment.inExperiment(NativeNotebook.experiment)) {
            return;
        }
        const content = await this.fs.readFile(path.join(this.context.extensionPath, 'package.json'));
        const updatedContent = content
            .replace('"enableProposedApi": false', '"enableProposedApi": true')
            .replace('"remove_prefix_when_vsc_releases_api_notebookOutputRenderer"', '"notebookOutputRenderer"')
            .replace('"remove_prefix_when_vsc_releases_api_notebookProvider"', '"notebookProvider"');

        // This code is temporary.
        if (content !== updatedContent) {
            await this.fs.writeFile(path.join(this.context.extensionPath, 'package.json'), updatedContent);
            await this.commandManager
                .executeCommand('python.reloadVSCode', 'Please reload VS Code to use the new VS Code Notebook API')
                .then(noop, noop);
        }
        this.disposables.push(
            notebook.registerNotebookContentProvider('jupyter-notebook', this.notebookContentProvider)
        );
        this.disposables.push(notebook.registerNotebookKernel('jupyter-notebook', ['**/*.ipynb'], this.notebookKernel));
        this.disposables.push(
            notebook.registerNotebookOutputRenderer(
                'jupyter-notebook-renderer',
                {
                    type: 'display_data',
                    subTypes: [
                        'image/png',
                        'image/jpeg',
                        'text/html',
                        'text/plain',
                        'text/latex',
                        'application/vnd.plotly.v1+json',
                        'application/vnd.vega.v5+json'
                    ]
                },
                this.renderer
            )
        );
    }
}
