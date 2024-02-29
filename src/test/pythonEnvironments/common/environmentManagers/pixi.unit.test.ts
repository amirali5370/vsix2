import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import { ExecutionResult, ShellOptions } from '../../../../client/common/process/types';
import * as externalDependencies from '../../../../client/pythonEnvironments/common/externalDependencies';
import { TEST_LAYOUT_ROOT } from '../commonTestConstants';
import { Pixi } from '../../../../client/pythonEnvironments/common/environmentManagers/pixi';

export type HatchCommand = { cmd: 'info --json' } | { cmd: null };

const textPixiDir = path.join(TEST_LAYOUT_ROOT, 'pixi');
export const projectDirs = {
    windows: {
        path: path.join(textPixiDir, 'windows'),
        info: {
            environments_info: [
                {
                    prefix: path.join(textPixiDir, 'windows', '.pixi', 'envs', 'default'),
                },
            ],
        },
    },
    nonWindows: {
        path: path.join(textPixiDir, 'non-windows'),
        info: {
            environments_info: [
                {
                    prefix: path.join(textPixiDir, 'non-windows', '.pixi', 'envs', 'default'),
                },
            ],
        },
    },
    multiEnv: {
        path: path.join(textPixiDir, 'multi-env'),
        info: {
            environments_info: [
                {
                    prefix: path.join(textPixiDir, 'multi-env', '.pixi', 'envs', 'default'),
                },
                {
                    prefix: path.join(textPixiDir, 'multi-env', '.pixi', 'envs', 'py310'),
                },
                {
                    prefix: path.join(textPixiDir, 'multi-env', '.pixi', 'envs', 'py311'),
                },
            ],
        },
    },
};

/**
 * Convert the command line arguments into a typed command.
 */
export function pixiCommand(args: string[]): HatchCommand {
    if (args.length < 2) {
        return { cmd: null };
    }
    if (args[0] === 'info' && args[1] === '--json') {
        return { cmd: 'info --json' };
    }
    return { cmd: null };
}
interface VerifyOptions {
    pixiPath?: string;
    cwd?: string;
}

export function makeExecHandler(verify: VerifyOptions = {}) {
    return async (file: string, args: string[], options: ShellOptions): Promise<ExecutionResult<string>> => {
        /// Verify that the executable path is indeed the one we expect it to be
        if (verify.pixiPath && file !== verify.pixiPath) {
            throw new Error('Command failed: not the correct pixi path');
        }

        /// Verify that the working directory is the expected one
        const cwd = typeof options.cwd === 'string' ? options.cwd : options.cwd?.toString();
        if (verify.cwd) {
            if (!cwd || !externalDependencies.arePathsSame(cwd, verify.cwd)) {
                throw new Error(`Command failed: not the correct path, expected: ${verify.cwd}, got: ${cwd}`);
            }
        }

        /// Convert the command into a single string
        const cmd = pixiCommand(args);
        if (cmd.cmd === 'info --json') {
            const project = Object.values(projectDirs).find((p) => cwd?.startsWith(p.path));
            if (!project) {
                throw new Error('Command failed: could not find project');
            }
            return { stdout: JSON.stringify(project.info) };
        }

        throw new Error(`Command failed: unknown command ${args}`);
    };
}

suite('Pixi binary is located correctly', async () => {
    let exec: sinon.SinonStub;
    let getPythonSetting: sinon.SinonStub;

    setup(() => {
        getPythonSetting = sinon.stub(externalDependencies, 'getPythonSetting');
        exec = sinon.stub(externalDependencies, 'exec');
    });

    teardown(() => {
        sinon.restore();
    });

    const testPath = async (pixiPath: string, verify = true) => {
        getPythonSetting.returns(pixiPath);
        // If `verify` is false, don’t verify that the command has been called with that path
        exec.callsFake(makeExecHandler(verify ? { pixiPath, cwd: projectDirs.nonWindows.path } : undefined));
        const pixi = await Pixi.getPixi(projectDirs.nonWindows.path);
        expect(pixi?.command).to.equal(pixiPath);
    };

    test('Return a Pixi instance in an empty directory', () => testPath('hatchPath', false));
    test('When user has specified a valid Pixi path, use it', () => testPath('path/to/pixi/binary'));
    // 'pixi' is the default value
    test('When user hasn’t specified a path, use Pixi on PATH if available', () => testPath('pixi'));

    test('Return undefined if Pixi cannot be found', async () => {
        getPythonSetting.returns('pixi');
        exec.callsFake((_file: string, _args: string[], _options: ShellOptions) =>
            Promise.reject(new Error('Command failed')),
        );
        const hatch = await Pixi.getPixi(projectDirs.nonWindows.path);
        expect(hatch?.command).to.equal(undefined);
    });
});
