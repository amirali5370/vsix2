// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import { TestRun, Uri } from 'vscode';
import { IConfigurationService, ITestOutputChannel } from '../../../common/types';
import { createDeferred } from '../../../common/utils/async';
import { EXTENSION_ROOT_DIR } from '../../../constants';
import {
    DataReceivedEvent,
    ExecutionTestPayload,
    ITestExecutionAdapter,
    ITestResultResolver,
    ITestServer,
    TestCommandOptions,
    TestExecutionCommand,
} from '../common/types';
import { traceLog } from '../../../logging';
import { startTestIdServer } from '../common/utils';

/**
 * Wrapper Class for unittest test execution. This is where we call `runTestCommand`?
 */

export class UnittestTestExecutionAdapter implements ITestExecutionAdapter {
    constructor(
        public testServer: ITestServer,
        public configSettings: IConfigurationService,
        private readonly outputChannel: ITestOutputChannel,
        private readonly resultResolver?: ITestResultResolver,
    ) {}

    public async runTests(
        uri: Uri,
        testIds: string[],
        debugBool?: boolean,
        runInstance?: TestRun,
    ): Promise<ExecutionTestPayload> {
        const uuid = this.testServer.createUUID(uri.fsPath);
        const disposedDataReceived = this.testServer.onRunDataReceived((e: DataReceivedEvent) => {
            if (runInstance) {
                this.resultResolver?.resolveExecution(JSON.parse(e.data), runInstance);
            }
        });
        const dispose = function () {
            disposedDataReceived.dispose();
        };
        runInstance?.token.onCancellationRequested(() => {
            this.testServer.deleteUUID(uuid);
            dispose();
        });
        await this.runTestsNew(uri, testIds, uuid, runInstance, debugBool, dispose);
        const executionPayload: ExecutionTestPayload = { cwd: uri.fsPath, status: 'success', error: '' };
        return executionPayload;
    }

    private async runTestsNew(
        uri: Uri,
        testIds: string[],
        uuid: string,
        runInstance?: TestRun,
        debugBool?: boolean,
        dispose?: () => void,
    ): Promise<ExecutionTestPayload> {
        const settings = this.configSettings.getSettings(uri);
        const { unittestArgs } = settings.testing;
        const cwd = settings.testing.cwd && settings.testing.cwd.length > 0 ? settings.testing.cwd : uri.fsPath;

        const command = buildExecutionCommand(unittestArgs);

        const options: TestCommandOptions = {
            workspaceFolder: uri,
            command,
            cwd,
            uuid,
            debugBool,
            testIds,
            outChannel: this.outputChannel,
        };

        const deferred = createDeferred<ExecutionTestPayload>();
        traceLog(`Running UNITTEST execution for the following test ids: ${testIds}`);

        const runTestIdsPort = await startTestIdServer(testIds);

        await this.testServer.sendCommand(options, runTestIdsPort.toString(), runInstance, () => {
            this.testServer.deleteUUID(uuid);
            deferred.resolve();
            dispose?.();
        });
        // placeholder until after the rewrite is adopted
        // TODO: remove after adoption.
        const executionPayload: ExecutionTestPayload = { cwd, status: 'success', error: '' };
        return executionPayload;
    }
}

function buildExecutionCommand(args: string[]): TestExecutionCommand {
    const executionScript = path.join(EXTENSION_ROOT_DIR, 'pythonFiles', 'unittestadapter', 'execution.py');

    return {
        script: executionScript,
        args: ['--udiscovery', ...args],
    };
}
