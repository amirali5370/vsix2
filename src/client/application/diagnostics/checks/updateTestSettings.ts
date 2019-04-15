// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { DiagnosticSeverity } from 'vscode';
import { IApplicationEnvironment, IWorkspaceService } from '../../../common/application/types';
import { IFileSystem } from '../../../common/platform/types';
import { IDisposableRegistry, IPersistentState, IPersistentStateFactory, Resource } from '../../../common/types';
import { swallowExceptions } from '../../../common/utils/decorators';
import { Diagnostics } from '../../../common/utils/localize';
import { IServiceContainer } from '../../../ioc/types';
import { BaseDiagnostic, BaseDiagnosticsService } from '../base';
import { IDiagnosticsCommandFactory } from '../commands/types';
import { DiagnosticCodes } from '../constants';
import { DiagnosticCommandPromptHandlerServiceId, MessageCommandPrompt } from '../promptHandler';
import { DiagnosticScope, IDiagnostic, IDiagnosticHandlerService } from '../types';

export class InvalidTestSettingsDiagnostic extends BaseDiagnostic {
    constructor() {
        super(
            DiagnosticCodes.InvalidTestSettingDiagnostic,
            Diagnostics.invalidTestSettings(),
            DiagnosticSeverity.Error,
            DiagnosticScope.WorkspaceFolder,
            undefined,
            'always'
        );
    }
}

export const InvalidTestSettingsDiagnosticscServiceId = 'InvalidTestSettingsDiagnosticscServiceId';

@injectable()
export class InvalidTestSettingDiagnosticsService extends BaseDiagnosticsService {
    protected readonly messageService: IDiagnosticHandlerService<MessageCommandPrompt>;
    protected readonly stateStore: IPersistentState<string[]>;
    constructor(@inject(IServiceContainer) serviceContainer: IServiceContainer,
        @inject(IFileSystem) private readonly fs: IFileSystem,
        @inject(IApplicationEnvironment) private readonly application: IApplicationEnvironment,
        @inject(IPersistentStateFactory) stateFactory: IPersistentStateFactory,
        @inject(IDiagnosticsCommandFactory) private readonly commandFactory: IDiagnosticsCommandFactory,
        @inject(IWorkspaceService) private readonly workspace: IWorkspaceService,
        @inject(IDisposableRegistry) disposableRegistry: IDisposableRegistry) {
        super([DiagnosticCodes.InvalidEnvironmentPathVariableDiagnostic], serviceContainer, disposableRegistry, true);
        this.messageService = serviceContainer.get<IDiagnosticHandlerService<MessageCommandPrompt>>(
            IDiagnosticHandlerService,
            DiagnosticCommandPromptHandlerServiceId
        );
        this.stateStore = stateFactory.createGlobalPersistentState<string[]>('python.unitTestSetting', []);
    }
    public async diagnose(_resource: Resource): Promise<IDiagnostic[]> {
        const filesToBeFixed = await this.getFilesToBeFixed();
        if (filesToBeFixed.length === 0) {
            return [];
        } else {
            return [new InvalidTestSettingsDiagnostic()];
        }
    }
    public async onHandle(diagnostics: IDiagnostic[]): Promise<void> {
        // This class can only handle one type of diagnostic, hence just use first item in list.
        if (diagnostics.length === 0 || !this.canHandle(diagnostics[0]) ||
            !(diagnostics[0] instanceof InvalidTestSettingsDiagnostic)) {
            return;
        }
        const diagnostic = diagnostics[0];
        const options = [
            {
                prompt: 'Yes, update settings',
                command: {
                    diagnostic,
                    invoke: async (): Promise<void> => {
                        const filesToBeFixed = await this.getFilesToBeFixed();
                        await Promise.all(filesToBeFixed.map(file => this.fixSettingInFile(file)));
                    }
                }
            },
            { prompt: 'No, I will do it later' },
            {
                prompt: 'Do not show again',
                command: this.commandFactory.createCommand(diagnostic, { type: 'ignore', options: DiagnosticScope.Global })
            }
        ];

        await this.messageService.handle(diagnostic, { commandPrompts: options });
    }
    public getSettingsFiles() {
        if (!this.workspace.hasWorkspaceFolders) {
            return this.application.userSettingsFile ? [this.application.userSettingsFile] : [];
        }
        return this.workspace.workspaceFolders!
            .map(item => path.join(item.uri.fsPath, '.vscode', 'settings.json'))
            .concat(this.application.userSettingsFile ? [this.application.userSettingsFile] : []);
    }
    public async getFilesToBeFixed() {
        const files = this.getSettingsFiles();
        const result = await Promise.all(files.map(async file => {
            const needsFixing = await this.doesFileNeedToBeFixed(file);
            return { file, needsFixing };
        }));
        return result.filter(item => item.needsFixing).map(item => item.file);
    }
    @swallowExceptions('Failed to check if file needs to be fixed')
    public async doesFileNeedToBeFixed(filePath: string) {
        // If we have fixed the path to this file once before,
        // then no need to check agian. If user adds subsequently, nothing we can do,
        // as user will see warnings in editor about invalid entries.
        // This will speed up loading of extension (reduce unwanted disc IO).
        if (this.stateStore.value.indexOf(filePath) >= 0) {
            return false;
        }
        const contents = await this.fs.readFile(filePath);
        return contents.indexOf('python.unitTest.') > 0;
    }
    @swallowExceptions('Failed to update settings.json')
    public async fixSettingInFile(filePath: string) {
        const fileContents = await this.fs.readFile(filePath);
        const setting = new RegExp('"python.unitTest', 'g');

        await this.fs.writeFile(filePath, fileContents.replace(setting, '"python.testing'));

        // Keep track of updated file.
        this.stateStore.value.push(filePath);
        await this.stateStore.updateValue(this.stateStore.value.slice());
    }
}
