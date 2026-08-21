import { ServiceUnavailableError } from "../../shared/errors/app-error.js";
import type {
  PropertyAssetStorage,
  StorePropertyAssetInput,
  StoredPropertyAsset
} from "./property-asset-storage.js";

export class UnavailablePropertyAssetStorage implements PropertyAssetStorage {
  async store(_input: StorePropertyAssetInput): Promise<StoredPropertyAsset> {
    throw new ServiceUnavailableError("Managed property uploads are not configured");
  }

  async createReadUrl(_objectKey: string, _expiresAt: Date): Promise<string> {
    throw new ServiceUnavailableError("Managed property uploads are not configured");
  }
}
