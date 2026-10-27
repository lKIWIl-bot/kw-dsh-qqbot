"""Only resize an already-generated oversized PNG for temporary QQ previews."""
import io,sys
from PIL import Image
Image.MAX_IMAGE_PIXELS=20000000
raw=sys.stdin.buffer.read(64*1048576+1)
if len(raw)>64*1048576:raise ValueError('preview input too large')
with Image.open(io.BytesIO(raw)) as source:
    source.load()
    image=source.convert('RGBA' if 'A' in source.getbands() else 'RGB')
    image.thumbnail((2048,2048),Image.Resampling.LANCZOS)
    out=io.BytesIO();image.save(out,format='PNG')
    if out.tell()>20*1048576:raise ValueError('preview output too large')
    sys.stdout.buffer.write(out.getvalue())
