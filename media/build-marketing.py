from pathlib import Path
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'artifacts' / 'marketing'
PUBLIC = ROOT / 'public' / 'media'
FFMPEG = ROOT / 'tools' / 'media-python' / 'imageio_ffmpeg' / 'binaries' / 'ffmpeg-win-x86_64-v7.1.exe'
FONT = Path('C:/Windows/Fonts')
ART.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)

def font(name, size):
    return ImageFont.truetype(str(FONT / name), size)

def make_poster():
    base = ImageOps.fit(Image.open(ART / 'poster-engine.png').convert('RGB'), (1600, 2000), method=Image.Resampling.LANCZOS)
    base = ImageEnhance.Contrast(ImageEnhance.Color(base).enhance(0.88)).enhance(1.12)
    image = Image.alpha_composite(base.convert('RGBA'), Image.new('RGBA', base.size, (3, 11, 14, 125)))
    draw = ImageDraw.Draw(image)
    amber, pale, muted = (235, 188, 115, 255), (238, 241, 230, 255), (183, 199, 190, 255)
    mono = font('consolab.ttf', 21)
    draw.rectangle((0, 0, 1600, 487), fill=(3, 10, 13, 184))
    draw.rectangle((0, 1312, 1600, 2000), fill=(3, 10, 13, 218))
    draw.line((80, 92, 1518, 92), fill=(235, 188, 115, 118), width=2)
    draw.rectangle((84, 121, 112, 149), outline=amber, width=2)
    for bar_x in (90, 97, 104):
        draw.rectangle((bar_x, 127, bar_x + 2, 143), fill=amber)
    draw.text((126, 125), 'BLACKGRID', font=font('ARIALNB.TTF', 31), fill=pale)
    draw.text((1514, 137), 'FIELD BUILD 01     /     CO-OP SURVIVAL', font=font('consolab.ttf', 17), fill=amber, anchor='ra')
    draw.text((80, 204), "DON'T LET THE LIGHT DIE.", font=font('ARIALNB.TTF', 116), fill=pale, stroke_width=1, stroke_fill=(0, 0, 0, 120))
    draw.text((86, 342), 'THE CITY WENT DARK. YOU DIDN’T.', font=font('consolab.ttf', 25), fill=amber)
    draw.text((1514, 387), 'SECTOR 07  /  09°58′ N  76°17′ E', font=font('consola.ttf', 16), fill=muted, anchor='ra')

    # The main panel features an actual captured game frame, framed as a field photo.
    hero = ImageOps.fit(Image.open(ART / 'wide-engine.png').convert('RGB'), (1432, 790), method=Image.Resampling.LANCZOS)
    hero = ImageEnhance.Contrast(ImageEnhance.Color(hero).enhance(1.08)).enhance(1.08)
    image.paste(hero, (84, 488))
    draw = ImageDraw.Draw(image)
    draw.rectangle((72, 476, 1528, 1300), outline=(235, 188, 115, 220), width=3)
    draw.rectangle((84, 1220, 1516, 1278), fill=(4, 12, 15, 216))
    draw.text((108, 1237), '01  /  COLD START', font=font('consolab.ttf', 20), fill=amber)
    draw.text((1490, 1239), 'MUNICIPAL POWER STATION  •  NIGHTFALL', font=font('consola.ttf', 17), fill=pale, anchor='ra')

    draw.text((84, 1340), 'ONE CITY. FIFTEEN SURVIVORS. A GRID THAT WON’T STAY ON.', font=font('ARIALNB.TTF', 34), fill=pale)
    draw.text((86, 1394), 'SCAVENGE AMBER CELLS   /   HOLD THE LINE   /   BRING THE LIGHT BACK', font=font('consolab.ttf', 17), fill=amber)

    cards = [
        ('02-scavenge', 1.7, 'SCAVENGE', 'FIND THE LAST POWER CELLS'),
        ('03-combat', 2.8, 'FIGHT', 'THE INFECTED REMEMBER'),
        ('04-drive', 2.4, 'RESTORE', 'MAKE A RUN FOR THE GRID'),
    ]
    card_w, card_h, gap, start_x, card_y = 456, 257, 31, 84, 1450
    for index, (clip, at, heading, subheading) in enumerate(cards):
        still = ART / f'.poster-{index}.png'
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(at), '-i', str(ART / f'{clip}.webm'), '-frames:v', '1', '-vf', f'scale={card_w}:170:force_original_aspect_ratio=increase,crop={card_w}:170', str(still)], check=True)
        x = start_x + index * (card_w + gap)
        draw.rectangle((x - 3, card_y - 3, x + card_w + 3, card_y + card_h + 3), fill=(235, 188, 115, 185))
        thumbnail = Image.open(still).convert('RGB')
        image.paste(thumbnail, (x, card_y))
        draw = ImageDraw.Draw(image)
        draw.rectangle((x, card_y + 170, x + card_w, card_y + card_h), fill=(8, 19, 21, 255))
        draw.text((x + 15, card_y + 180), heading, font=font('consolab.ttf', 19), fill=amber)
        draw.text((x + 15, card_y + 211), subheading, font=font('consola.ttf', 14), fill=pale)
        still.unlink(missing_ok=True)

    draw = ImageDraw.Draw(image)
    draw.line((84, 1763, 1516, 1763), fill=(235, 188, 115, 185), width=2)
    draw.text((84, 1792), 'PLAY TOGETHER', font=font('consolab.ttf', 18), fill=amber)
    draw.text((84, 1823), 'DESKTOP  /  PHONE  /  TABLET', font=font('consola.ttf', 16), fill=pale)
    draw.text((1516, 1792), 'EARLY PLAYABLE BUILD', font=font('consolab.ttf', 18), fill=amber, anchor='ra')
    draw.text((1516, 1823), 'PLAYTEST INVITATION  •  TEMPORARY HOST', font=font('consola.ttf', 16), fill=pale, anchor='ra')
    draw.text((84, 1925), 'SCAVENGE   /   FIGHT   /   RESTORE', font=font('ARIALNB.TTF', 43), fill=pale)
    draw.text((1516, 1941), 'DON’T LET THE LIGHT DIE.', font=font('consolab.ttf', 17), fill=amber, anchor='ra')
    image.convert('RGB').save(ART / 'BLACKGRID-poster.png', optimize=True)

def make_overlay(label, final=False):
    image = Image.new('RGBA', (1280, 720), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if final:
        # A lightly shaded centered end slate keeps gameplay visible around the title.
        draw.rounded_rectangle((125, 207, 1155, 520), radius=8, fill=(3, 12, 15, 205), outline=(235, 188, 115, 135), width=2)
        draw.text((640, 275), 'BLACKGRID', font=font('ARIALNB.TTF', 73), fill=(235, 239, 229, 255), anchor='mm')
        draw.text((640, 357), "DON'T LET THE LIGHT DIE.", font=font('ARIALNB.TTF', 45), fill=(235, 188, 115, 255), anchor='mm')
        draw.text((640, 431), 'EARLY PLAYABLE BUILD  •  PLAYTEST INVITATION', font=font('consolab.ttf', 20), fill=(219, 229, 216, 255), anchor='mm')
    else:
        draw.rectangle((0, 566, 1280, 720), fill=(4, 12, 15, 192))
        draw.rectangle((72, 595, 78, 690), fill=(235, 188, 115, 255))
        draw.text((106, 598), 'BLACKGRID  /  FIELD BUILD 01', font=font('consolab.ttf', 17), fill=(235, 188, 115, 255))
        draw.text((106, 632), label, font=font('ARIALNB.TTF', 43), fill=(235, 239, 229, 255))
        draw.text((1205, 673), 'DON’T LET THE LIGHT DIE.', font=font('consola.ttf', 15), fill=(212, 221, 211, 255), anchor='rs')
    return image

def make_teaser():
    shots = [
        ('01-blackout', 'WHEN THE GRID GOES DARK'),
        ('02-scavenge', 'SCAVENGE TO SURVIVE'),
        ('03-combat', 'THE DARK LEARNS'),
        ('04-drive', 'FIGHT BACK'),
        ('05-power', 'BRING THE GRID ONLINE'),
        ('06-infection', 'DON’T GET BITTEN'),
    ]
    duration = 3.2
    inputs = []
    filters = []
    video_labels = []
    audio_labels = []
    next_input_index = 0
    for index, (name, label) in enumerate(shots):
        video_index = next_input_index
        inputs.extend(['-i', str(ART / f'{name}.webm')])
        overlay = ART / f'.overlay-{index}.png'
        make_overlay(label).save(overlay)
        overlay_index = video_index + 1
        inputs.extend(['-loop', '1', '-framerate', '30', '-i', str(overlay)])
        next_input_index += 2
        filters.append(f'[{video_index}:v]trim=duration={duration},setpts=PTS-STARTPTS,scale=1280:720:flags=lanczos,setsar=1,fps=30,format=yuv420p[b{index}]')
        filters.append(f'[{overlay_index}:v]format=rgba[o{index}]')
        filters.append(f'[b{index}][o{index}]overlay=0:0:shortest=1[v{index}]')
        filters.append(f'[{video_index}:a]atrim=duration={duration},asetpts=PTS-STARTPTS,aresample=48000[a{index}]')
        video_labels.append(f'[v{index}]')
        audio_labels.append(f'[a{index}]')
    final_index = next_input_index
    final_card = ART / '.overlay-final.png'
    make_overlay('', final=True).save(final_card)
    inputs.extend(['-loop', '1', '-framerate', '30', '-i', str(final_card)])
    filters.append(f'[{final_index}:v]trim=duration={duration},setpts=PTS-STARTPTS,scale=1280:720,setsar=1,fps=30,format=yuv420p[v{len(shots)}]')
    audio_labels.append('[a_final]')
    filters.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={duration},asetpts=PTS-STARTPTS[a_final]')
    video_labels.append(f'[v{len(shots)}]')
    joined = ''.join(item for pair in zip(video_labels, audio_labels) for item in pair)
    filters.append(joined + f'concat=n={len(shots)+1}:v=1:a=1[outv][outa]')
    destination = ART / 'BLACKGRID-teaser.mp4'
    command = [str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(filters), '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(destination)]
    try:
        subprocess.run(command, check=True)
    finally:
        for path in [ART / f'.overlay-{i}.png' for i in range(len(shots))] + [final_card]:
            path.unlink(missing_ok=True)

def main():
    make_poster()
    shutil.copy2(ART / '03-combat.webm', PUBLIC / 'gameplay-preview.webm')
    make_teaser()
    probe = subprocess.run([str(FFMPEG), '-v', 'error', '-i', str(ART / 'BLACKGRID-teaser.mp4'), '-f', 'null', '-'], capture_output=True, text=True)
    if probe.returncode:
        raise RuntimeError(probe.stderr)
    print(f'Poster: {ART / "BLACKGRID-poster.png"}')
    print(f'Teaser: {ART / "BLACKGRID-teaser.mp4"}')
    print(f'Lobby preview: {PUBLIC / "gameplay-preview.webm"}')

if __name__ == '__main__':
    main()
