import { Button } from "@/components/ui/button";
import { IdentificationResult } from "@/components/identify/IdentificationResult";
import FollowUpChat from "@/components/identify/FollowUpChat";
import type { IdentificationResult as IdentificationResultData } from "@/lib/ai/identification";

interface Props {
  previewUrl: string;
  result: IdentificationResultData;
  imageBlob: Blob;
  onReset: () => void;
}

export default function UnrecognizedPanel({ previewUrl, result, imageBlob, onReset }: Props) {
  return (
    <div className="space-y-6">
      <img
        src={previewUrl}
        alt="Unidentified photo"
        className="mx-auto block w-full max-w-sm rounded-xl object-contain"
      />
      <IdentificationResult title="Couldn't identify this photo" description={result.description} />
      <FollowUpChat imageBlob={imageBlob} anchor={null} />
      <Button
        type="button"
        onClick={onReset}
        className="w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
      >
        Try another photo
      </Button>
    </div>
  );
}
