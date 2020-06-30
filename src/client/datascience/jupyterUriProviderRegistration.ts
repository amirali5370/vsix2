// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { inject, injectable } from 'inversify';
import { IExtensions } from '../common/types';
import {
    IJupyterServerUri,
    IJupyterUriProvider,
    IJupyterUriProviderRegistration,
    JupyterServerUriHandle
} from './types';

@injectable()
export class JupyterUriProviderRegistration implements IJupyterUriProviderRegistration {
    private loadedOtherExtensionsPromise: Promise<void> | undefined;
    private pickerList: IJupyterUriProvider[] = [];

    constructor(@inject(IExtensions) private readonly extensions: IExtensions) {}

    public async getProviders(): Promise<ReadonlyArray<IJupyterUriProvider>> {
        await this.checkOtherExtensions();

        // Other extensions should have registered in their activate callback
        return this.pickerList;
    }

    public registerProvider(provider: IJupyterUriProvider) {
        this.pickerList.push(provider);
    }

    public async getJupyterServerUri(id: string, handle: JupyterServerUriHandle): Promise<IJupyterServerUri> {
        await this.checkOtherExtensions();

        const picker = this.pickerList.find((p) => p.id === id);
        if (picker) {
            return picker.getServerUri(handle);
        }
        throw new Error('Unknown server picker');
    }

    private checkOtherExtensions(): Promise<void> {
        if (!this.loadedOtherExtensionsPromise) {
            this.loadedOtherExtensionsPromise = this.loadOtherExtensions();
        }
        return this.loadedOtherExtensionsPromise;
    }

    private async loadOtherExtensions(): Promise<void> {
        const list = this.extensions.all
            .filter((e) => e.packageJSON?.contributes?.pythonRemoteServerProvider)
            .map((e) => (e.isActive ? Promise.resolve() : e.activate()));
        await Promise.all(list);
    }
}
