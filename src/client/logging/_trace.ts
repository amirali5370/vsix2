// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';

import { StopWatch } from '../common/utils/stopWatch';
import { sendTelemetryEvent } from '../telemetry';
import { LogLevel } from './levels';
import { _log as log } from './logger';
import { TraceOptions } from './types';
import { argsToLogString, returnValueToLogString } from './util';

// tslint:disable-next-line:no-any
export function traceVerbose(...args: any[]) {
    log(LogLevel.Info, ...args);
}

// tslint:disable-next-line:no-any
export function traceError(...args: any[]) {
    log(LogLevel.Error, ...args);
}

// tslint:disable-next-line:no-any
export function traceInfo(...args: any[]) {
    log(LogLevel.Info, ...args);
}

// tslint:disable-next-line:no-any
export function traceWarning(...args: any[]) {
    log(LogLevel.Warn, ...args);
}

export namespace traceDecorators {
    export function verbose(message: string, opts: TraceOptions = TraceOptions.Arguments | TraceOptions.ReturnValue) {
        return trace(message, opts);
    }
    export function error(message: string) {
        return trace(message, TraceOptions.Arguments | TraceOptions.ReturnValue, LogLevel.Error);
    }
    export function info(message: string) {
        return trace(message);
    }
    export function warn(message: string) {
        return trace(message, TraceOptions.Arguments | TraceOptions.ReturnValue, LogLevel.Warn);
    }
}

function formatMessages(
    opts: TraceOptions,
    message: string,
    kind: string,
    name: string,
    elapsed: number,
    // tslint:disable-next-line:no-any
    args: any[],
    // tslint:disable-next-line:no-any
    returnValue?: any
): string {
    const messages = [message];
    messages.push(
        `${kind} name = ${name}`.trim(),
        `completed in ${elapsed}ms`,
        `has a ${returnValue ? 'truthy' : 'falsy'} return value`
    );
    if ((opts & TraceOptions.Arguments) === TraceOptions.Arguments) {
        messages.push(argsToLogString(args));
    }
    if ((opts & TraceOptions.ReturnValue) === TraceOptions.ReturnValue) {
        messages.push(returnValueToLogString(returnValue));
    }
    return messages.join(', ');
}

function trace(message: string, opts: TraceOptions = TraceOptions.None, logLevel?: LogLevel) {
    // tslint:disable-next-line:no-function-expression no-any
    return function (_: Object, __: string, descriptor: TypedPropertyDescriptor<any>) {
        const originalMethod = descriptor.value;
        // tslint:disable-next-line:no-function-expression no-any
        descriptor.value = function (...args: any[]) {
            const className = _ && _.constructor ? _.constructor.name : '';
            // tslint:disable-next-line:no-any
            function writeSuccess(elapsedTime: number, returnValue: any) {
                if (logLevel === LogLevel.Error) {
                    return;
                }
                writeToLog(elapsedTime, returnValue);
            }
            function writeError(elapsedTime: number, ex: Error) {
                writeToLog(elapsedTime, undefined, ex);
            }
            // tslint:disable-next-line:no-any
            function writeToLog(elapsedTime: number, returnValue?: any, ex?: Error) {
                const formatted = formatMessages(opts, message, 'Class', className, elapsedTime, args, returnValue);
                if (ex) {
                    log(LogLevel.Error, formatted, ex);
                    // tslint:disable-next-line:no-any
                    sendTelemetryEvent('ERROR' as any, undefined, undefined, ex);
                } else {
                    log(LogLevel.Info, formatted);
                }
            }
            const timer = new StopWatch();
            try {
                // tslint:disable-next-line:no-invalid-this no-use-before-declare no-unsafe-any
                const result = originalMethod.apply(this, args);
                // If method being wrapped returns a promise then wait for it.
                // tslint:disable-next-line:no-unsafe-any
                if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
                    // tslint:disable-next-line:prefer-type-cast
                    (result as Promise<void>)
                        .then((data) => {
                            writeSuccess(timer.elapsedTime, data);
                            return data;
                        })
                        .catch((ex) => {
                            writeError(timer.elapsedTime, ex);
                        });
                } else {
                    writeSuccess(timer.elapsedTime, result);
                }
                return result;
            } catch (ex) {
                writeError(timer.elapsedTime, ex);
                throw ex;
            }
        };

        return descriptor;
    };
}
